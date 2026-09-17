/**
 * aiProxy.ts — client de la fonction Edge Supabase « groq ».
 *
 * POURQUOI : la clé Groq ne doit JAMAIS être exposée au navigateur (elle
 * finirait dans le bundle JS, lisible par n'importe qui). TOUS les appels au
 * modèle passent donc par la fonction Edge (supabase/functions/groq), qui lit
 * la clé dans les secrets Supabase. Le navigateur n'envoie que les messages.
 *
 * CONTRAT DE FIABILITÉ (POINT 1 — fiabilité) :
 *   - TIMEOUT explicite de 15 s par tentative (AbortController) ;
 *   - RETRY automatique : 3 tentatives côté client (délais 1 s puis 2 s, la
 *     fonction Edge appliquant en plus son propre backoff 1 s / 2 s / 4 s) ;
 *   - un JSON invalide en mode JSON est RETENTÉ automatiquement ;
 *   - le message d'erreur FRANÇAIS renvoyé par la fonction est PRÉSERVÉ
 *     (jamais remplacé par un code HTTP brut) → toujours affichable ;
 *   - aucun échec silencieux : chaque erreur est loguée avec son contexte.
 *
 * STREAMING (POINT 3 — vitesse) : `callAiProxyStream` relaie le flux SSE de la
 * fonction pour afficher la réponse au fur et à mesure, sans jamais exposer la
 * clé ; en cas d'échec du flux, l'appelant peut retomber sur `callAiProxy`.
 */

import { describeError, fetchWithTimeout, logError, logInfo, withRetry } from "./net";

/** URL publique de la fonction Edge, définie au build (voir .env.example). */
export const AI_PROXY_DEFAULT_URL = String(
  import.meta.env?.VITE_SUPABASE_FUNCTIONS_URL ?? "",
).trim();

/**
 * OPTION DE DÉVELOPPEMENT — désactivée par défaut.
 *
 * La clé Groq ne doit JAMAIS être exposée au navigateur : tout appel part vers
 * la fonction Edge. Cette option n'existe que pour le développement local
 * (aucune fonction déployée) ; il faut la demander explicitement avec
 * `VITE_ALLOW_DIRECT_AI_KEY=true` dans `.env.local`, jamais en production.
 */
export const DIRECT_AI_KEY_ALLOWED =
  import.meta.env?.VITE_ALLOW_DIRECT_AI_KEY === "true";

/** Délai maximum d'une tentative (consigne : 15 s max par appel). */
const TIMEOUT_MS = 15_000;
/** Tentatives côté client. Le service retente lui-même (1 s / 2 s / 4 s). */
const ATTEMPTS = 3;
/** Délais client entre tentatives : 1 s puis 2 s. */
const RETRY_DELAYS_MS = [1_000, 2_000];

export class AiProxyError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Une nouvelle tentative a-t-elle une chance d'aboutir ? */
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "AiProxyError";
  }
}

/** True si une passerelle Edge est disponible (URL fournie ou configurée). */
export function isProxyConfigured(url?: string | null): boolean {
  return Boolean(((url ?? "") || AI_PROXY_DEFAULT_URL).trim());
}

export interface ProxyChatPayload {
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Demande un flux SSE (affichage progressif). */
  stream?: boolean;
  /**
   * // FIX (POINT 3 — vitesse) : effort de raisonnement transmis au modèle
   * « reasoning » (gpt-oss). Plus il est bas, moins de jetons partent en
   * réflexion : réponse plus rapide et moins de réponses vides.
   */
  reasoningEffort?: "low" | "medium" | "high";
}

interface ProxyResponseBody {
  ok?: boolean;
  content?: string;
  model?: string;
  error?: string;
  detail?: string;
}

/** Extrait le premier objet JSON valide d'un texte (tolère le texte autour). */
function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  for (let end = cleaned.length; end > start; end--) {
    try {
      return JSON.parse(cleaned.slice(start, end)) as unknown;
    } catch {
      // on réduit la fenêtre jusqu'à trouver un JSON valide
    }
  }
  return null;
}

/** Statuts qui valent une nouvelle tentative côté client. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function endpointOf(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function bodyOf(payload: ProxyChatPayload): string {
  return JSON.stringify({
    model: payload.model,
    messages: payload.messages,
    max_tokens: payload.maxTokens,
    json_mode: payload.jsonMode === true,
    stream: payload.stream === true,
    reasoning_effort: payload.reasoningEffort,
    // 0.3 : résultats stables et reproductibles (exigence explicite).
    temperature: 0.3,
  });
}

/** Convertit une réponse non-OK de la fonction en erreur française affichable. */
async function errorFromResponse(res: Response): Promise<AiProxyError> {
  let data: ProxyResponseBody | null = null;
  try {
    data = (await res.json()) as ProxyResponseBody;
  } catch {
    data = null;
  }
  const message =
    data?.error ??
    `Oups, la recherche a échoué (HTTP ${res.status}). Réessaie dans quelques secondes.`;
  const retryable = res.status === 0 || RETRYABLE_STATUS.has(res.status);
  logError("aiProxy", new Error(message), { statut: res.status, detail: data?.detail });
  return new AiProxyError(message, res.status, retryable);
}

/** Lit le corps JSON d'une réponse réussie et valide le contenu. */
function readContent(data: ProxyResponseBody, jsonMode: boolean): string {
  const content = (data.content ?? "").trim();
  if (!content) {
    throw new AiProxyError(
      "Oups, l'analyse est revenue vide. Réessaie dans quelques secondes.",
      undefined,
      true,
    );
  }
  if (jsonMode && extractJsonObject(content) == null) {
    // // FIX (POINT 1) : JSON invalide → nouvelle tentative automatique.
    throw new AiProxyError(
      "Oups, l'analyse n'a pas renvoyé un format exploitable. Réessaie dans quelques secondes.",
      undefined,
      true,
    );
  }
  return content;
}

/**
 * Appelle la fonction Edge et renvoie le contenu texte du modèle.
 * Toute erreur ressort en français, prête à être affichée à l'utilisateur.
 */
export async function callAiProxy(url: string, payload: ProxyChatPayload): Promise<string> {
  const endpoint = endpointOf(url);
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: bodyOf({ ...payload, stream: false }),
          },
          TIMEOUT_MS,
        );
        if (!res.ok) throw await errorFromResponse(res);
        let data: ProxyResponseBody;
        try {
          data = (await res.json()) as ProxyResponseBody;
        } catch {
          throw new AiProxyError(
            `Oups, la recherche a échoué : la fonction d'analyse a renvoyé une réponse illisible (HTTP ${res.status}). Réessaie.`,
            res.status,
            true,
          );
        }
        if (data.ok === false) {
          throw new AiProxyError(
            data.error ?? "Oups, l'analyse a échoué côté serveur. Réessaie dans quelques secondes.",
            res.status,
            true,
          );
        }
        return readContent(data, payload.jsonMode === true);
      },
      {
        attempts: ATTEMPTS,
        delays: RETRY_DELAYS_MS,
        label: "Fonction d'analyse",
        shouldRetry: (err) => !(err instanceof AiProxyError) || err.retryable,
        onRetry: (attempt, total) =>
          logInfo("aiProxy", `Nouvelle tentative ${attempt + 1}/${total} vers la fonction d'analyse`),
      },
    );
  } catch (err) {
    if (err instanceof AiProxyError) throw err;
    const message = describeError(err);
    logError("aiProxy", err, { endpoint });
    throw new AiProxyError(`Oups, la recherche a échoué : ${message}. Réessaie dans quelques secondes.`);
  }
}

/**
 * Variante STREAMING (SSE) : la fonction relaie le flux du modèle, le texte
 * partiel est poussé à `onDelta` au fur et à mesure.
 *
 * Le timeout de 15 s s'applique à l'INACTIVITÉ (aucun octet reçu), pas à la
 * durée totale : un long rapport peut donc s'écrire progressivement.
 */
export async function callAiProxyStream(
  url: string,
  payload: ProxyChatPayload,
  onDelta: (fullText: string) => void,
): Promise<string> {
  const endpoint = endpointOf(url);
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), TIMEOUT_MS);
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyOf({ ...payload, stream: true }),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !contentType.includes("event-stream")) {
      // La fonction a refusé le flux (erreur renvoyée en JSON) : on laisse
      // l'appelant retomber sur l'appel classique.
      throw await errorFromResponse(res);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const chunk = JSON.parse(raw) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: string;
          };
          if (chunk.error) throw new AiProxyError(chunk.error, undefined, false);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full);
          }
        } catch (err) {
          if (err instanceof AiProxyError) throw err;
          // Fragment SSE incomplet — ignoré, le prochain complétera.
        }
      }
    }

    if (!full.trim()) {
      throw new AiProxyError("Oups, le flux de réponse était vide. Réessaie.", undefined, true);
    }
    return full;
  } catch (err) {
    if (err instanceof AiProxyError) {
      logError("aiProxy", err, { endpoint, mode: "stream" });
      throw err;
    }
    const aborted = err instanceof DOMException && err.name === "AbortError";
    logError("aiProxy", err, { endpoint, mode: "stream" });
    throw new AiProxyError(
      aborted
        ? "Oups, l'analyse a mis trop de temps à répondre (15 s). Réessaie."
        : `Oups, la recherche a échoué : ${describeError(err)}. Réessaie dans quelques secondes.`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(idle);
  }
}
