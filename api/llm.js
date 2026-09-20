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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
        // Recommandations OpenRouter (traçabilité côté tableau de bord).
        "X-Title": "GeoLead Finder",
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
    return {
      kind: "retryable",
      detail: timedOut ? "delai depasse " + Math.round(TIMEOUT_MS / 1000) + " s" : String(err && err.message ? err.message : err).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm(baseUrl, apiKey, body) {
  const models = modelsFor(String(body.model || "").trim(), baseUrl);
  const useResponseFormat = LOCAL_URL.test(baseUrl);
  let budget = Math.min(body.max_tokens || MAX_TOKENS_CAP, MAX_TOKENS_CAP);
  let lastError = "erreur inconnue";

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
        lastError = model + " : " + (result.detail || result.kind);
        console.warn("[llm] " + lastError + " - modele suivant");
      }
      if (i < models.length - 1) await sleep(MODEL_DELAY_MS);
    }
  }
  return { ok: false, error: lastError };
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

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return failure(
      "Service mal configuré : la clé LLM_API_KEY n'est pas définie dans les variables d'environnement.",
      "vercel env add LLM_API_KEY production",
      500,
    );
  }
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_LLM_URL).trim().replace(/\/+$/, "");

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return failure("Requête invalide : aucun message fourni.", undefined, 400);
  }

  const result = await callLlm(baseUrl, apiKey, body);
  if (result.ok) {
    return reply({ ok: true, content: result.content, model: result.model });
  }
  return failure("Oups, l'analyse a échoué. Réessaie dans quelques secondes. (" + result.error + ")", result.detail);
}
