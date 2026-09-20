export const config = { runtime: "edge" };

const process = globalThis.process;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * // FIX (IA en ligne) : fournisseur hébergé OpenRouter (clé côté serveur).
 * Le serveur IA LOCAL n'est joignable que depuis la machine de l'utilisateur ;
 * en ligne, la passerelle relaie désormais vers OpenRouter. Modèles GRATUITS
 * mesurés en direct (2026-09) :
 *   - nex-agi/nex-n2.5-mini:free : JSON propre en ~1,4 s (étapes structurées) ;
 *   - nex-agi/nex-n2.5-pro:free  : rapports rédigés en français, ~3 s ;
 *   - replis : z-ai/glm-5.2:free, google/gemma-4-31b-it:free (parfois
 *     saturés côté amont, 429 temporaires → rotation de modèle).
 */
const DEFAULT_LLM_URL = "https://openrouter.ai/api/v1";
/**
 * // FIX (choix du fournisseur) : le client peut demander explicitement le
 * fournisseur IA via `provider` : "openrouter" (hébergé, marche PC éteint) ou
 * "local" (serveur OpenAI-compatible de la machine, URL LLM_LOCAL_URL avec sa
 * clé LLM_LOCAL_API_KEY — utilisable uniquement quand la passerelle tourne
 * là où le serveur tourne, c'est-à-dire en local).
 */
const PROVIDERS = new Set(["openrouter", "local"]);
/** Serveur IA LOCAL de la machine (routeur « auto », clé dédiée). */
const DEFAULT_LOCAL_URL = "http://127.0.0.1:31415/v1";
const MODEL_POOL = [
  "nex-agi/nex-n2.5-mini:free",
  "nex-agi/nex-n2.5-pro:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
];
const TIMEOUT_MS = 45_000;
/** Délais ENTRE MODÈLES puis entre manches complètes. */
const MODEL_DELAY_MS = 1_000;
const ROUND_DELAYS_MS = [2_500, 6_000];
const ROUNDS = ROUND_DELAYS_MS.length + 1;
const MAX_TOKENS_CAP = 3_000;
/** Le routeur LOCAL conserve « auto » (choix garanti chez lui). */
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i;
/**
 * // FIX (choix du fournisseur) : en-têtes supplémentaires pour OpenRouter
 * (traçabilité côté tableau de bord). Le serveur local les ignore.
 */
function headersFor(baseUrl) {
  const h = { "Content-Type": "application/json" };
  if (!LOCAL_URL.test(baseUrl)) h["X-Title"] = "GeoLead Finder";
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reply(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function failure(message, detail, status = 502) {
  return reply({ ok: false, error: message, detail }, status);
}

/** Objets JSON utiles uniquement ({} vide = échec des fournisseurs gratuits). */
function extractJsonObject(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  for (let end = cleaned.length; end > start; end--) {
    const candidate = cleaned.slice(start, end);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return candidate;
      }
    } catch {
      // on réduit la fenêtre jusqu'à trouver un JSON valide
    }
  }
  return null;
}

/** Chaîne de modèles à essayer : demandé d'abord, puis pool gratuit. */
function modelsFor(requested, baseUrl) {
  const chain = requested && requested !== "auto" ? [requested] : [];
  const pool = LOCAL_URL.test(baseUrl) ? ["auto", ...MODEL_POOL] : [...MODEL_POOL];
  return [...chain, ...pool].filter((m, i, all) => m && all.indexOf(m) === i);
}

function classifyFailure(status, detail) {
  if (
    status === 404 ||
    /model_not_found|is not in the catalog|does not exist|decommissioned|not found or removed upstream|no endpoints found/i.test(detail)
  ) {
    return "unknown_model";
  }
  if (status === 401 || status === 403) {
    return "bad_key";
  }
  if (status === 429 || status >= 500) {
    return "retryable";
  }
  return "fatal";
}

async function callOnce(baseUrl, apiKey, model, body, budget, useResponseFormat) {
  const extraHeaders = headersFor(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        ...extraHeaders,
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.3,
        max_tokens: budget,
        // // FIX (mesuré) : les fournisseurs GRATUITS d'OpenRouter renvoient un
        // objet vide avec response_format json_object → on ne l'envoie QUE au
        // routeur local. Ailleurs : consigne dans le prompt + extraction client.
        ...(useResponseFormat && body.json_mode
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { kind: classifyFailure(res.status, detail), detail: detail.slice(0, 220) };
    }
    const data = await res.json().catch(() => null);
    const content =
      (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    if (!String(content).trim()) {
      return { kind: "empty", model: data && data.model };
    }
    if (body.json_mode && !extractJsonObject(String(content))) {
      return { kind: "bad_json", model: data && data.model };
    }
    return { kind: "ok", content: String(content), model: data && data.model };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    // // FIX (fournisseur local) : « fetch failed » / connexion refusée = le
    // serveur est éteint → erreur DÉDIÉE (non générique) pour que l'app puisse
    // dire « démarre ton serveur ou bascule sur OpenRouter ».
    const detail = String(err && err.message ? err.message : err);
    if (timedOut || /fetch failed|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ECONNRESET/i.test(detail)) {
      return { kind: "unreachable", error: detail.slice(0, 200) };
    }
    return { kind: "retryable", error: detail.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm(baseUrl, apiKey, body, provider) {
  const models = modelsFor(String(body.model || "").trim(), baseUrl);
  // // FIX : le routeur LOCAL accepte response_format json_object ; les
  // fournisseurs GRATUITS d'OpenRouter renvoient {} avec ce champ → on ne
  // l'envoie qu'au serveur local. Ailleurs : consigne dans le prompt.
  const useResponseFormat = LOCAL_URL.test(baseUrl);
  let budget = Math.min(body.max_tokens || MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  let lastError = "erreur inconnue";
  let unreachable = false;

  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) {
      const delay = ROUND_DELAYS_MS[round - 1];
      console.log("[llm] manche " + (round + 1) + "/" + ROUNDS + " dans " + delay + " ms (apres : " + lastError + ")");
      await sleep(delay);
    }
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const result = await callOnce(baseUrl, apiKey, model, body, budget, useResponseFormat);
      if (result.kind === "ok") {
        return { ok: true, content: result.content, model: result.model || model };
      }
      if (result.kind === "bad_key") {
        return {
          ok: false,
          error: "la cle du serveur d'analyse est invalide ou expiree",
          detail: result.detail,
        };
      }
      if (result.kind === "empty" || result.kind === "bad_json") {
        budget = Math.min(MAX_TOKENS_CAP, Math.max(900, budget * 2));
        lastError = (result.kind === "empty" ? "reponse vide" : "JSON invalide") + " via " + model;
        console.warn("[llm] " + lastError + " - modele suivant");
      } else {
        // // FIX (fournisseur local) : serveur éteint → inutile d'épuiser la
        // chaîne de modèles ni d'attendre les délais entre manches : on sort
        // immédiatement avec l'erreur dédiée.
        if (result.kind === "unreachable") {
          unreachable = true;
          lastError = result.error || lastError;
          break;
        }
        lastError = model + " : " + (result.detail || result.error || result.kind);
        console.warn("[llm] " + lastError + " - modele suivant");
      }
      if (i < models.length - 1) await sleep(MODEL_DELAY_MS);
    }
    if (unreachable) break;
  }
  return unreachable
    ? { ok: false, kind: "unreachable", error: lastError }
    : { ok: false, error: lastError };
}

function crossOriginBlocked(req) {
  const allowed = (process.env.ALLOWED_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!allowed) return false;
  const origin = (req.headers.get("origin") || "").trim().replace(/\/+$/, "");
  if (!origin) return false;
  if (origin === allowed) return false;
  try {
    return !origin.endsWith(new URL(allowed).hostname);
  } catch {
    return false;
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return failure("Méthode non autorisée.", undefined, 405);
  if (crossOriginBlocked(req)) {
    return failure(
      "Accès refusé : cette passerelle n'est utilisable que depuis l'application.",
      undefined,
      403,
    );
  }

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return failure("Requête invalide : aucun message fourni.", undefined, 400);
  }

  //
  // // FIX (choix du fournisseur) : le client choisit le fournisseur IA.
  //   - "local" : serveur OpenAI-compatible de la machine (routeur « auto »,
  //     clé LLM_LOCAL_API_KEY). Uniquement joignable quand la passerelle tourne
  //     sur la même machine que le serveur — en production Vercel, la connexion
  //     est refusée et l'erreur l'explique clairement.
  //   - "openrouter" (défaut) : hébergé, fonctionne même PC éteint.
  //
  const requestedProvider = String(body.provider || "").trim().toLowerCase();
  // // FIX (fournisseur local) : détection correcte du fournisseur quand le
  // client n'en demande aucun — on compare à la configuration réelle, pas à
  // une variable qui n'existe pas encore à cet endroit du code.
  const defaultBaseUrl = (process.env.LLM_BASE_URL || DEFAULT_LLM_URL).trim().replace(/\/+$/, "");
  let baseUrl;
  let apiKey;
  let provider;
  if (requestedProvider === "local" || (requestedProvider !== "openrouter" && LOCAL_URL.test(defaultBaseUrl))) {
    provider = "local";
    baseUrl = (process.env.LLM_LOCAL_URL || DEFAULT_LOCAL_URL).trim().replace(/\/+$/, "");
    apiKey = (process.env.LLM_LOCAL_API_KEY || "").trim();
    if (!apiKey) {
      return failure(
        "Fournisseur local indisponible : la clé LLM_LOCAL_API_KEY n'est pas définie côté serveur. Basculez sur OpenRouter dans les Réglages.",
        "vercel env add LLM_LOCAL_API_KEY production",
        500,
      );
    }
  } else {
    provider = "openrouter";
    baseUrl = (process.env.LLM_BASE_URL || DEFAULT_LLM_URL).trim().replace(/\/+$/, "");
    apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      return failure(
        "Service mal configuré : la clé LLM_API_KEY n'est pas définie dans les variables d'environnement.",
        "vercel env add LLM_API_KEY production",
        500,
      );
    }
  }

  const result = await callLlm(baseUrl, apiKey, body, provider);
  if (result.ok) {
    return reply({ ok: true, content: result.content, model: result.model, provider });
  }
  if (result.kind === "unreachable") {
    return failure(
      provider === "local"
        ? "Le serveur IA local ne répond pas. Vérifie qu'il est démarré, ou bascule sur OpenRouter dans les Réglages."
        : "Le fournisseur IA ne répond pas. Réessaie dans quelques secondes.",
      result.error,
    );
  }
  return failure("Oups, l'analyse a échoué. Réessaie dans quelques secondes. (" + result.error + ")", result.detail);
}
