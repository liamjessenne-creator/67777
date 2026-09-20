import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { ServerResponse } from "node:http";

/**
 * FIX (remplacement de Groq) : le navigateur ne peut pas appeler directement le
 * serveur IA (aucun en-tête CORS, vérifié) → la clé vit dans ce processus Node
 * et les appels passent par `/api/llm`.
 *
 * FIX (choix du fournisseur) : la passerelle de dev accepte désormais
 * `provider` dans le corps de la requête, exactement comme api/llm.js en
 * production :
 *   - "openrouter" (défaut) → LLM_BASE_URL + LLM_API_KEY ;
 *   - "local"               → LLM_LOCAL_URL + LLM_LOCAL_API_KEY (serveur
 *     compatible OpenAI de la machine, routeur « auto »).
 * Le contrat de réponse est celui d'api/llm.js : { ok, content, model, provider }.
 */

/** Pool gratuit OpenRouter mesuré en direct (rotation sur 429 / réponse vide). */
const MODEL_POOL = [
  "nex-agi/nex-n2.5-mini:free",
  "nex-agi/nex-n2.5-pro:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
];
const LOCAL_URL_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i;
const DEFAULT_LLM_URL = "https://openrouter.ai/api/v1";
const DEFAULT_LOCAL_URL = "http://127.0.0.1:31415/v1";
const TIMEOUT_MS = 45_000;
const MAX_TOKENS_CAP = 3_000;
const MODEL_DELAY_MS = 1_000;
/** Deux manches au maximum en dev (l'utilisateur voit l'attente de toute façon). */
const ROUND_DELAYS_MS = [2_500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function modelsFor(requested: string, isLocal: boolean): string[] {
  const chain = requested && requested !== "auto" ? [requested] : [];
  const pool = isLocal ? ["auto", ...MODEL_POOL] : [...MODEL_POOL];
  return [...chain, ...pool].filter((m, i, all) => m && all.indexOf(m) === i);
}

function classifyFailure(status: number, detail: string): "unknown_model" | "bad_key" | "retryable" | "fatal" {
  if (
    status === 404 ||
    /model_not_found|is not in the catalog|does not exist|decommissioned|not found or removed upstream|no endpoints found/i.test(detail)
  ) {
    return "unknown_model";
  }
  if (status === 401 || status === 403) return "bad_key";
  if (status === 429 || status >= 500) return "retryable";
  return "fatal";
}

type CallResult =
  | { kind: "ok"; content: string; model: string }
  | { kind: "empty" | "bad_json" | "retryable" | "unknown_model" | "fatal" | "unreachable"; error?: string; model?: string }
  | { kind: "bad_key" };

async function callOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean,
  budget: number,
  useResponseFormat: boolean,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!LOCAL_URL_RE.test(baseUrl)) headers["X-Title"] = "GeoLead Finder";
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: budget,
        // FIX (mesuré) : les fournisseurs GRATUITS d'OpenRouter renvoient {}
        // avec response_format json_object → on ne l'envoie qu'au serveur local.
        ...(useResponseFormat && jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const kind = classifyFailure(res.status, detail);
      return kind === "bad_key" ? { kind } : { kind, error: detail.slice(0, 220) };
    }
    const data = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; model?: string }
      | null;
    const content = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!content) return { kind: "empty", model: data?.model };
    if (jsonMode && !/\{[\s\S]*\}/.test(content)) return { kind: "bad_json", model: data?.model };
    return { kind: "ok", content, model: data?.model || model };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    const detail = String(err instanceof Error ? err.message : err);
    // FIX (fournisseur local) : serveur éteint → erreur DÉDIÉE, sans épuiser
    // la chaîne de modèles ni attendre les délais entre manches.
    if (timedOut || /fetch failed|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ECONNRESET/i.test(detail)) {
      return { kind: "unreachable", error: detail.slice(0, 200) };
    }
    return { kind: "retryable", error: detail.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function replyError(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

/** Passerelle de dev : même contrat qu'api/llm.js, dans le processus Vite. */
function createLlmGateway(env: Record<string, string>): Connect.NextHandleFunction {
  return async (req, res) => {
    if (req.method !== "POST") {
      replyError(res, 405, { ok: false, error: "Méthode non autorisée." });
      return;
    }
    let body: { model?: string; messages?: unknown; max_tokens?: number; json_mode?: boolean; provider?: string } | null = null;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      replyError(res, 400, { ok: false, error: "Requête invalide : aucun message fourni." });
      return;
    }

    const requestedProvider = String(body.provider || "").trim().toLowerCase();
    const openrouterUrl = (env.LLM_BASE_URL || DEFAULT_LLM_URL).trim().replace(/\/+$/, "");
    const wantsLocal = requestedProvider === "local" || (requestedProvider !== "openrouter" && LOCAL_URL_RE.test(openrouterUrl));

    const isLocal = wantsLocal;
    const baseUrl = wantsLocal
      ? (env.LLM_LOCAL_URL || DEFAULT_LOCAL_URL).trim().replace(/\/+$/, "")
      : openrouterUrl;
    const apiKey = wantsLocal
      ? (env.LLM_LOCAL_API_KEY || env.LLM_API_KEY || "").trim()
      : (env.LLM_API_KEY || "").trim();
    if (!apiKey) {
      replyError(res, 500, {
        ok: false,
        error: wantsLocal
          ? "Fournisseur local indisponible : la clé LLM_LOCAL_API_KEY n'est pas définie dans .env.local."
          : "Service mal configuré : la clé LLM_API_KEY n'est pas définie dans .env.local.",
      });
      return;
    }

    const useResponseFormat = LOCAL_URL_RE.test(baseUrl);
    const messages = body.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>;
    const jsonMode = body.json_mode === true;
    const models = modelsFor(String(body.model || "").trim(), isLocal);
    let budget = Math.min(body.max_tokens || MAX_TOKENS_CAP, MAX_TOKENS_CAP);
    let lastError = "erreur inconnue";

    for (let round = 0; round <= ROUND_DELAYS_MS.length; round++) {
      if (round > 0) await sleep(ROUND_DELAYS_MS[round - 1]);
      let unreachable = false;
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const result = await callOnce(baseUrl, apiKey, model, messages, jsonMode, budget, useResponseFormat);
        if (result.kind === "ok") {
          res.end(
            JSON.stringify({ ok: true, content: result.content, model: result.model, provider: isLocal ? "local" : "openrouter" }),
          );
          return;
        }
        if (result.kind === "bad_key") {
          replyError(res, 200, {
            ok: false,
            error: "La clé du fournisseur d'analyse est invalide ou expirée.",
          });
          return;
        }
        if (result.kind === "unreachable") {
          unreachable = true;
          lastError = result.error || lastError;
          break;
        }
        if (result.kind === "empty" || result.kind === "bad_json") {
          budget = Math.min(MAX_TOKENS_CAP, Math.max(900, budget * 2));
          lastError = (result.kind === "empty" ? "réponse vide" : "JSON invalide") + " via " + model;
        } else {
          lastError = model + " : " + (result.error || result.kind);
        }
        console.warn("[llm:dev]", lastError, "— modèle suivant");
        if (i < models.length - 1) await sleep(MODEL_DELAY_MS);
      }
      if (unreachable) break;
    }

    replyError(res, 502, {
      ok: false,
      error: isLocal
        ? "Le serveur IA local ne répond pas. Vérifie qu'il est démarré, ou bascule sur OpenRouter dans les Réglages."
        : "Oups, l'analyse a échoué. Réessaie dans quelques secondes. (" + lastError + ")",
      detail: lastError,
    });
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      // FIX (choix du fournisseur) : middleware /api/llm — même contrat que la
      // fonction serverless Vercel, avec les DEUX fournisseurs disponibles.
      {
        name: "llm-gateway-dev",
        configureServer(server) {
          server.middlewares.use("/api/llm", createLlmGateway(env as unknown as Record<string, string>));
        },
      } satisfies Plugin,
    ],
    server: {
      port: 5199,
      strictPort: true,
    },
    test: {
      environment: "node",
      include: ["*.test.ts"],
    },
  };
});
