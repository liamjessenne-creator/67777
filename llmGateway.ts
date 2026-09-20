/**
 * llmGateway.ts — contrat de la passerelle IA (`/api/llm`).
 *
 * // FIX (remplacement de Groq) : le fournisseur IA de l'outil est désormais un
 * serveur LOCAL compatible OpenAI (routeur « auto »), et non plus l'API Groq.
 * Ce module décrit le CONTRAT entre le navigateur et la passerelle serveur, et
 * fournit les utilitaires partagés (client + fonction serverless) :
 *
 *   navigateur ──POST /api/llm──▶ fonction serverless ──POST /v1/chat/completions──▶ serveur IA local
 *              { model, messages, max_tokens, json_mode, stream }      { Authorization: Bearer LLM_API_KEY }
 *
 * POURQUOI une passerelle : (1) la clé du serveur IA ne doit jamais apparaître
 * dans le bundle du navigateur ; (2) le serveur local n'expose AUCUN en-tête
 * CORS — un appel direct depuis le navigateur est impossible ; (3) en
 * production (Vercel), le serveur tourne sur la machine de l'utilisateur :
 * la passerelle relaie vers LLM_BASE_URL, qui vaut http://127.0.0.1:31415/v1
 * en usage local (tunnel public possible pour un déploiement distant).
 *
 * PARTICULARITÉS DU ROUTEUR (mesurées, pas supposées) :
 *   - le champ `model` peut être omis ou valoir « auto » : le routeur choisit
 *     un modèle du catalogue à chaque requête (le choix varie) ;
 *   - « épuisement des fournisseurs gratuits » arrive par intermittence
 *     (HTTP 503) → retentable après quelques secondes ;
 *   - la latence varie beaucoup selon le modèle tiré (1 s à 35 s) : les délais
 *     côté client sont donc plus souples que pour Groq ;
 *   - certains modèles raisonneurs renvoient des blocs <think> dans le contenu
 *     → nettoyés côté client (stripThinking existe déjà).
 */

/** URL par défaut de la passerelle (même origine que l'app). */
export const LLM_GATEWAY_DEFAULT_URL = "/api/llm";

/**
 * // FIX (IA en ligne) : fournisseur hébergé par défaut — OpenRouter. Le
 * serveur IA LOCAL reste possible (il suffit de pointer LLM_BASE_URL dessus),
 * mais il n'est joignable que depuis la machine : en ligne, la passerelle
 * relaie vers OpenRouter avec la clé côté serveur. Modèles GRATUITS mesurés
 * en direct : mini rend un JSON propre en ~1,4 s, pro rédige les rapports
 * français en ~3 s. Les 429 du pool gratuit déclenchent une rotation de
 * modèle côté passerelle.
 */
export const DEFAULT_PROVIDER_BASE_URL = "https://openrouter.ai/api/v1";

/** Modèle « routeur » du serveur LOCAL (seul choix garanti chez soi). */
export const AUTO_MODEL = "auto";

/**
 * Modèle rapide pour les étapes simples (JSON courts, découverte de site).
 * Mesuré : JSON pur en ~1,4 s, champ « raisonnement » séparé du contenu.
 */
export const FAST_MODEL = "nex-agi/nex-n2.5-mini:free";
/** Alias sémantique : le modèle utilisé pour les étapes JSON strictes. */
export const JSON_MODEL = FAST_MODEL;

/**
 * Pool de modèles gratuits OpenRouter, dans l'ordre de préférence. Utilisé
 * par le client (repli si un modèle est mort) et par la passerelle serveur.
 */
export const MODEL_POOL = [
  "nex-agi/nex-n2.5-mini:free",
  "nex-agi/nex-n2.5-pro:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
] as const;

/** Modèle principal pour les rapports rédigés (qualité française mesurée). */
export const MAIN_MODEL = "nex-agi/nex-n2.5-pro:free";

/**
 * Fournisseur IA choisi pour une requête :
 *  - `openrouter` : hébergé (marche même PC éteint) — défaut ;
 *  - `local` : serveur compatible OpenAI de la machine (routeur « auto », clé
 *    dédiée). Uniquement joignable quand l'app tourne LÀ où tourne le serveur,
 *    c'est-à-dire en local — en ligne, la passerelle renvoie une erreur claire.
 */
export type AiProvider = "openrouter" | "local";

/** Fournisseur par défaut (hébergé) quand le client n'exprime pas de choix. */
export const DEFAULT_PROVIDER: AiProvider = "openrouter";

/** Message renvoyé par le routeur quand ses fournisseurs gratuits saturent. */
export function looksLikeExhausted(detail: string): boolean {
  return /all models exhausted|no candidate model|rate limits to reset|service_unavailable/i.test(
    detail,
  );
}

/** Vrai si l'erreur amont signale un modèle absent du catalogue (404). */
export function looksLikeUnknownModel(detail: string): boolean {
  return /model_not_found|is not in the catalog|does not exist|decommissioned/i.test(detail);
}

/** Contrat du corps envoyé par le navigateur à la passerelle. */
export interface GatewayRequest {
  /** « auto » (routeur) ou un identifiant du catalogue /v1/models. */
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  /** Force une réponse JSON (response_format json_object côté OpenAI). */
  json_mode?: boolean;
  /** Demande un relais du flux SSE (affichage progressif). */
  stream?: boolean;
  /**
   * // FIX (choix du fournisseur) : fournisseur demandé pour CET appel.
   * Absent = le choix par défaut de la passerelle (openrouter).
   */
  provider?: AiProvider;
}

/** Réponse non-flux de la passerelle. */
export interface GatewayResponse {
  ok: boolean;
  content?: string;
  /** Modèle réellement utilisé par le routeur (diagnostic). */
  model?: string;
  error?: string;
  detail?: string;
}

/** Traduit le contrat interne vers un corps OpenAI-compatible. */
export function toOpenAiBody(req: GatewayRequest): Record<string, unknown> {
  return {
    // « auto » ou omission : le routeur choisit. Un identifiant inconnu du
    // catalogue renverrait un 404 définitif → on laisse « auto » en repli.
    model: req.model?.trim() || AUTO_MODEL,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.max_tokens,
    ...(req.json_mode ? { response_format: { type: "json_object" } } : {}),
    ...(req.stream ? { stream: true } : {}),
  };
}
