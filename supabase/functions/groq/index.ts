/**
 * Supabase Edge Function « groq » — passerelle unique vers l'API Groq.
 *
 * POURQUOI : la clé Groq ne doit JAMAIS se trouver dans le code du navigateur
 * (elle finirait dans le bundle JS, visible par n'importe qui). Elle est donc
 * stockée dans les secrets Supabase et n'est lue qu'ici, côté serveur.
 *
 * LE CONTRAT DE FIABILITÉ (PROBLÈME 1) :
 *   - 15 s de timeout maximum par tentative (AbortController) ;
 *   - 1 essai + 3 tentatives, avec délais de 1 s → 2 s → 4 s ;
 *   - si Groq renvoie du JSON invalide, on retente automatiquement ;
 *   - tout échec renvoie un message CLAIR EN FRANÇAIS + le détail technique ;
 *   - le navigateur n'envoie que les messages : jamais de clé.
 *
 * DÉPLOIEMENT :
 *   supabase link --project-ref <votre-ref>
 *   supabase secrets set GROQ_API_KEY=gsk_...
 *   supabase functions deploy groq --no-verify-jwt
 * → URL publique : https://<votre-ref>.supabase.co/functions/v1/groq
 *   à renseigner dans VITE_SUPABASE_FUNCTIONS_URL (voir .env.example).
 */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
/** 15 secondes maximum par tentative (exigence explicite). */
const TIMEOUT_MS = 15_000;
/** Délais entre tentatives : 1 s puis 2 s puis 4 s. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
/** Plafond de jetons de sortie — on ne paie jamais pour du texte inutile. */
const MAX_TOKENS_CAP = 3_000;
/** Modèle demandé par défaut. */
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
/**
 * Replis automatiques : un identifiant de modèle peut être retiré du catalogue
 * Groq (un 404 ferait échouer toute l'analyse) — on bascule alors sur un modèle
 * disponible du même fournisseur, sans jamais interrompre le travail en cours.
 */
const MODEL_FALLBACKS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
/** Même principe pour les étapes simples : on privilégie un petit modèle rapide. */
const MODEL_FALLBACKS_SMALL = [
  "llama-3.1-8b-instant",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
];

/**
 * Mémoire du modèle qui a RÉELLEMENT répondu, par modèle demandé. Les instances
 * de la fonction sont réutilisées : on évite ainsi de repayer deux allers-retours
 * en 404 à chaque appel quand un identifiant n'est plus au catalogue.
 */
const resolvedModels = new Map<string, string>();

/** Chaîne d'essai : modèle demandé → modèle déjà résolu → replis connus. */
function modelsFor(requested: string): string[] {
  const chain = /(8b|instant|mini|20b)/i.test(requested) ? MODEL_FALLBACKS_SMALL : MODEL_FALLBACKS;
  const memo = resolvedModels.get(requested);
  const ordered = [requested, ...(memo && memo !== requested ? [memo] : []), ...chain];
  return ordered.filter((m, i) => ordered.indexOf(m) === i);
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ProxyBody {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  json_mode?: boolean;
  /** Demande un flux SSE relayé tel quel au navigateur (affichage progressif). */
  stream?: boolean;
  /**
   * Effort de raisonnement des modèles gpt-oss : « low » réduit fortement les
   * jetons dépensés en réflexion (réponse plus rapide, moins de vides).
   */
  reasoning_effort?: "low" | "medium" | "high";
}

/**
 * `reasoning_effort` n'est envoyé que pour les modèles qui raisonnent réellement
 * (gpt-oss, compound) : un modèle standard renverrait une erreur 400.
 */
function reasoningEffort(
  model: string,
  effort?: "low" | "medium" | "high",
): Record<string, string> {
  if (!effort || !/gpt-oss|compound/i.test(model)) return {};
  return { reasoning_effort: effort };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function reply(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Échec côté service : message français + détail technique pour le diagnostic. */
function failure(message: string, detail?: string, status = 502): Response {
  return reply({ ok: false, error: message, detail }, status);
}

/** Extrait l'objet JSON d'une réponse de modèle (tolère le texte autour). */
function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  for (let end = cleaned.length; end > start; end--) {
    const candidate = cleaned.slice(start, end);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // on réduit la fenêtre jusqu'à trouver un JSON valide
    }
  }
  return null;
}

interface AttemptResult {
  ok: boolean;
  content?: string;
  error?: string;
  modelUnavailable?: boolean;
}

/** Un appel Groq complet : timeout 15 s + 3 tentatives (1 s / 2 s / 4 s). */
async function callGroq(apiKey: string, body: ProxyBody, model: string): Promise<AttemptResult> {
  let lastError = "erreur inconnue";
  /**
   * Budget de jetons, ÉLARGI à chaque réponse vide ou JSON invalide : les
   * modèles de raisonnement consomment des jetons en réflexion avant de
   * rédiger, et un budget trop serré renvoie une génération vide (HTTP 400
   * `json_validate_failed` en mode JSON). C'est la cause n°1 des échecs
   * « aléatoires » — on l'absorbe ici, côté serveur.
   */
  let budget = Math.min(body.max_tokens ?? MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  const widenBudget = () => {
    budget = Math.min(MAX_TOKENS_CAP, Math.max(900, budget * 2));
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`[groq] tentative ${attempt + 1} dans ${delay} ms (après : ${lastError})`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: body.messages,
          // 0.3 : résultats stables et reproductibles (exigence explicite).
          temperature: body.temperature ?? 0.3,
          max_tokens: budget,
          ...(body.json_mode ? { response_format: { type: "json_object" } } : {}),
          ...reasoningEffort(model, body.reasoning_effort),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Modèle retiré du catalogue → on passe au repli suivant.
        if (res.status === 404 || /model_not_found|does not exist|decommissioned/i.test(detail)) {
          return { ok: false, error: `modèle « ${model} » indisponible`, modelUnavailable: true };
        }
        // 429 / 5xx : on retente ; les autres erreurs sont définitives.
        if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        return { ok: false, error: `le service d'analyse a répondu HTTP ${res.status} ${detail.slice(0, 200)}` };
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? "";

      if (!content.trim()) {
        lastError = "réponse vide du modèle";
        if (attempt < RETRY_DELAYS_MS.length) {
          widenBudget();
          console.log(`[groq] réponse vide — nouvelle tentative avec ${budget} jetons`);
          continue;
        }
        return { ok: false, error: lastError };
      }

      // Mode JSON : on valide AVANT de répondre, et on retente si c'est invalide.
      if (body.json_mode) {
        if (!extractJsonObject(content)) {
          lastError = "réponse JSON invalide";
          if (attempt < RETRY_DELAYS_MS.length) {
            widenBudget();
            console.log(`[groq] JSON invalide — nouvelle tentative avec ${budget} jetons`);
            continue;
          }
          return { ok: false, error: "le modèle n'a pas renvoyé un JSON valide" };
        }
      }

      return { ok: true, content };
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      lastError = timedOut
        ? `délai dépassé (${TIMEOUT_MS / 1000} s)`
        : err instanceof Error
          ? err.message
          : String(err);
      if (attempt >= RETRY_DELAYS_MS.length) return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError };
}

/**
 * Relaie le flux SSE du modèle vers le navigateur (POINT 3 — affichage
 * progressif). La réponse est renvoyée dès le premier octet : l'utilisateur
 * voit le texte s'écrire au lieu d'attendre la fin de la génération.
 *
 * Le backoff 1 s / 2 s / 4 s s'applique tant qu'AUCUNE donnée n'a commencé à
 * circuler ; si le flux casse en cours de route, on envoie un événement
 * d'erreur français au client (le client retombe alors sur l'appel classique).
 */
async function streamGroq(apiKey: string, body: ProxyBody, model: string): Promise<Response> {
  let lastError = "erreur inconnue";

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.log(`[groq:stream] nouvelle tentative dans ${delay} ms (après : ${lastError})`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: body.messages,
          temperature: body.temperature ?? 0.3,
          max_tokens: Math.min(body.max_tokens ?? MAX_TOKENS_CAP, MAX_TOKENS_CAP),
          ...(body.json_mode ? { response_format: { type: "json_object" } } : {}),
          ...reasoningEffort(model, body.reasoning_effort),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        if (res.status === 404 || /model_not_found|does not exist|decommissioned/i.test(detail)) {
          return failure(`modèle « ${model} » indisponible`, detail.slice(0, 200), 404);
        }
        lastError = `HTTP ${res.status} ${detail.slice(0, 200)}`;
        if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) continue;
        return failure(
          "Oups, l'analyse a échoué. Réessaie dans quelques secondes.",
          lastError,
          res.status >= 400 && res.status < 600 ? res.status : 502,
        );
      }

      // Flux accepté : on RELAIE tel quel, sans le mettre en tampon.
      clearTimeout(timer);
      return new Response(res.body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      lastError = timedOut
        ? `délai dépassé (${TIMEOUT_MS / 1000} s)`
        : err instanceof Error
          ? err.message
          : String(err);
      if (attempt >= RETRY_DELAYS_MS.length) break;
    }
  }

  return failure("Oups, l'analyse a échoué. Réessaie dans quelques secondes.", lastError);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Préflight CORS (l'app peut être servie depuis un autre domaine).
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return failure("Méthode non autorisée.", undefined, 405);

  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return failure(
      "Service mal configuré : la clé GROQ_API_KEY n'est pas définie dans les secrets Supabase.",
      "supabase secrets set GROQ_API_KEY=gsk_...",
      500,
    );
  }

  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return failure("Requête invalide : corps JSON illisible.", undefined, 400);
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return failure("Requête invalide : aucun message fourni.", undefined, 400);
  }

  // Ordre d'essai : le modèle demandé d'abord, puis les replis connus.
  const requested = body.model?.trim() || DEFAULT_MODEL;
  const models = modelsFor(requested);

  // Mode streaming : on tente le modèle demandé puis les replis, et on relaie
  // le flux dès que le fournisseur répond.
  if (body.stream === true) {
    let streamError = "erreur inconnue";
    for (const model of models) {
      const res = await streamGroq(apiKey, body, model);
      if (res.status !== 404) return res;
      const detail = await res.clone().json().catch(() => ({ detail: "" }));
      streamError = `modèle « ${model} » indisponible ${detail?.detail ?? ""}`.trim();
      console.warn(`[groq:stream] ${streamError} — bascule sur le modèle suivant`);
    }
    return failure("Oups, l'analyse a échoué. Réessaie dans quelques secondes.", streamError);
  }

  let lastError = "erreur inconnue";
  for (const model of models) {
    const result = await callGroq(apiKey, body, model);
    if (result.ok) {
      // On mémorise le modèle qui a répondu pour ne plus repayer les 404.
      resolvedModels.set(requested, model);
      return reply({ ok: true, content: result.content, model });
    }
    lastError = result.error ?? lastError;
    if (!result.modelUnavailable) break;
    console.warn(`[groq] ${lastError} — bascule sur le modèle suivant`);
  }

  return failure(`Oups, l'analyse a échoué. Réessaie dans quelques secondes. (${lastError})`);
});
