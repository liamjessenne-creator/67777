/**
 * llmClient.ts — client navigateur de la passerelle IA (`/api/llm`).
 *
 * // FIX (remplacement de Groq) : remplace aiProxy.ts (fonction Edge Supabase /
 * passerelle Groq) par un appel à la passerelle serveur unique, qui relaie vers
 * le serveur IA local compatible OpenAI. La clé du serveur ne transite JAMAIS
 * par le navigateur.
 *
 * CONTRAT DE FIABILITÉ (identique à l'ancien client) :
 *   - TIMEOUT explicite par tentative (AbortController) ;
 *   - RETRY automatique : 3 tentatives côté client, délais 1 s puis 2 s
 *     (la passerelle retente elle-même 4 fois côté serveur) ;
 *   - un JSON invalide en mode JSON est RETENTÉ automatiquement ;
 *   - les messages d'erreur FRANÇAIS renvoyés par la passerelle sont PRÉSERVÉS ;
 *   - aucun échec silencieux : chaque erreur est journalisée avec son contexte.
 *
 * STREAMING : `callGatewayStream` relaie le flux SSE pour afficher la réponse
 * au fur et à mesure. Le timeout s'applique à l'INACTIVITÉ (aucun octet reçu),
 * pas à la durée totale : le routeur local peut réfléchir 30 s avant d'écrire.
 */

import { describeError, fetchWithTimeout, logError, logInfo, withRetry } from "./net";
import { LLM_GATEWAY_DEFAULT_URL, MODEL_POOL, type GatewayRequest } from "./llmGateway";

/** Délai maximum d'une tentative côté navigateur (le routeur peut être lent). */
const TIMEOUT_MS = 45_000;
/** Tentatives côté client ; la passerelle retente elle-même en plus. */
const ATTEMPTS = 2;
const RETRY_DELAYS_MS = [1_000];

export class LlmGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Une nouvelle tentative a-t-elle une chance d'aboutir ? */
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "LlmGatewayError";
  }
}

/** URL de la passerelle : configurable, défaut `/api/llm` (même origine). */
export function gatewayUrl(configured?: string | null): string {
  const url = (configured ?? "").trim();
  return url || LLM_GATEWAY_DEFAULT_URL;
}

/** Vrai si une passerelle est disponible (toujours, en local comme en ligne). */
export function isGatewayConfigured(_configured?: string | null): boolean {
  return true;
}

/** Statuts qui valent une nouvelle tentative côté navigateur. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

interface GatewayResponseBody {
  ok?: boolean;
  content?: string;
  model?: string;
  error?: string | { message?: string };
  detail?: string;
  /**
   * // FIX : en DÉVELOPPEMENT, le proxy Vite relaie la réponse BRUTE du serveur
   * (format OpenAI), sans la transformation de contrat faite par api/llm.js en
   * production. Le client accepte donc les DEUX formes.
   */
  choices?: Array<{ message?: { content?: string } }>;
}

/** Message d'erreur lisible : chaîne directe ou objet OpenAI { message }. */
function errorMessageOf(data: GatewayResponseBody | null): string | undefined {
  const err = data?.error;
  if (!err) return undefined;
  return typeof err === "string" ? err : err.message;
}

type ClientRequest = GatewayRequest & { jsonMode?: boolean };

function gatewayBody(req: ClientRequest & { stream?: boolean }): string {
  return JSON.stringify({
    model: req.model,
    messages: req.messages,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    json_mode: req.jsonMode === true,
    stream: req.stream === true,
  });
}

async function errorFromResponse(res: Response): Promise<LlmGatewayError> {
  let data: GatewayResponseBody | null = null;
  try {
    data = (await res.json()) as GatewayResponseBody;
  } catch {
    data = null;
  }
  // Les messages d'erreur (string ou objet OpenAI) sont traduits en français.
  const message =
    errorMessageOf(data) ??
    `Oups, l'analyse a échoué (HTTP ${res.status}). Réessaie dans quelques secondes.`;
  const retryable = res.status === 0 || RETRYABLE_STATUS.has(res.status);
  logError("llmClient", new Error(message), { statut: res.status, detail: data?.detail });
  return new LlmGatewayError(message, res.status, retryable);
}

/**
 * Appelle la passerelle et renvoie le contenu texte du modèle.
 * Toute erreur ressort en français, prête à être affichée à l'utilisateur.
 */
export async function callGateway(url: string, req: ClientRequest): Promise<string> {
  const endpoint = gatewayUrl(url);
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: gatewayBody({ ...req, stream: false }),
          },
          TIMEOUT_MS,
        );
        if (!res.ok) throw await errorFromResponse(res);
        let data: GatewayResponseBody;
        try {
          data = (await res.json()) as GatewayResponseBody;
        } catch {
          throw new LlmGatewayError(
            `Oups, la passerelle d'analyse a renvoyé une réponse illisible (HTTP ${res.status}). Réessaie.`,
            res.status,
            true,
          );
        }
        if (data.ok === false) {
          throw new LlmGatewayError(
            errorMessageOf(data) ??
              "Oups, l'analyse a échoué côté serveur. Réessaie dans quelques secondes.",
            res.status,
            true,
          );
        }
        // // FIX : contrat passerelle (`content`) OU réponse brute OpenAI
        // (`choices[0].message.content`) — selon l'environnement.
        const content = (data.content ?? data.choices?.[0]?.message?.content ?? "").trim();
        if (!content) {
          // // FIX (IA en ligne) : réponse vide du modèle demandé (aléa du pool
          // gratuit) → on retente sur le modèle suivant du pool au lieu de
          // rejouer le même et d'échouer côté utilisateur.
          const next = MODEL_POOL.find((m) => m !== req.model);
          if (next) {
            logInfo("llmClient", `Réponse vide de « ${req.model} » — bascule sur « ${next} »`);
            const retryRes = await fetchWithTimeout(
              endpoint,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: gatewayBody({ ...req, model: next, stream: false }),
              },
              TIMEOUT_MS,
            );
            if (retryRes.ok) {
              const retryData = (await retryRes.json().catch(() => null)) as GatewayResponseBody | null;
              if (retryData?.ok !== false) {
                const retryContent = (
                  retryData?.content ?? retryData?.choices?.[0]?.message?.content ?? ""
                ).trim();
                if (retryContent) return retryContent;
              }
            }
          }
          throw new LlmGatewayError(
            "Oups, l'analyse est revenue vide. Réessaie dans quelques secondes.",
            undefined,
            true,
          );
        }
        return content;
      },
      {
        attempts: ATTEMPTS,
        delays: RETRY_DELAYS_MS,
        label: "Passerelle d'analyse",
        shouldRetry: (err) => !(err instanceof LlmGatewayError) || err.retryable,
        onRetry: (attempt, total) =>
          logInfo("llmClient", `Nouvelle tentative ${attempt + 1}/${total} vers la passerelle`),
      },
    );
  } catch (err) {
    if (err instanceof LlmGatewayError) throw err;
    const message = describeError(err);
    logError("llmClient", err, { endpoint });
    throw new LlmGatewayError(
      `Oups, l'analyse a échoué : ${message}. Réessaie dans quelques secondes.`,
    );
  }
}

/**
 * Variante STREAMING (SSE) : le texte partiel est poussé à `onDelta` au fur et
 * à mesure. En cas d'échec du flux, l'appelant retombe sur `callGateway`.
 */
export async function callGatewayStream(
  url: string,
  req: ClientRequest,
  onDelta: (fullText: string) => void,
): Promise<string> {
  const endpoint = gatewayUrl(url);
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
      body: gatewayBody({ ...req, stream: true }),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") ?? "";
    // // FIX : en production, la passerelle répond en JSON (pas de relais SSE).
    // Plutôt que de traiter cette réponse valide comme un échec (et de relancer
    // une GÉNÉRATION COMPLÈTE en classique), on l'accepte comme résultat final.
    if (res.ok && contentType.includes("application/json")) {
      const data = (await res.json()) as GatewayResponseBody;
      if (data.ok !== false) {
        const content = (data.content ?? data.choices?.[0]?.message?.content ?? "").trim();
        if (content) {
          onDelta(content);
          return content;
        }
      }
      throw await errorFromResponse(res);
    }
    if (!res.ok || !res.body || !contentType.includes("event-stream")) {
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
            choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
            error?: string;
          };
          if (chunk.error) throw new LlmGatewayError(chunk.error, undefined, false);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full);
          }
        } catch (err) {
          if (err instanceof LlmGatewayError) throw err;
          // Fragment SSE incomplet — ignoré, le prochain complétera.
        }
      }
    }

    if (!full.trim()) {
      // // FIX (IA en ligne) : flux vide (aléa du pool gratuit OpenRouter) →
      // on retente UNE fois le même appel en classique (la réponse complète
      // arrive souvent là où le flux a échoué) au lieu d'échouer côté UI.
      logInfo("llmClient", "Flux vide — nouvelle tentative en appel classique");
      return callGateway(endpoint, { ...req, stream: false });
    }
    return full;
  } catch (err) {
    if (err instanceof LlmGatewayError) {
      logError("llmClient", err, { endpoint, mode: "stream" });
      throw err;
    }
    const aborted = err instanceof DOMException && err.name === "AbortError";
    logError("llmClient", err, { endpoint, mode: "stream" });
    throw new LlmGatewayError(
      aborted
        ? "Oups, l'analyse a mis trop de temps à répondre. Réessaie."
        : `Oups, l'analyse a échoué : ${describeError(err)}. Réessaie dans quelques secondes.`,
      undefined,
      true,
    );
  } finally {
    clearTimeout(idle);
  }
}
