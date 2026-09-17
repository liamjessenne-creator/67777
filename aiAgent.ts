/**
 * AIAgentService — prompt-engineered audit engine against any OpenAI-compatible
 * endpoint (Groq by default, also DeepSeek/Qwen OpenAI-mode endpoints).
 */

import type { AiAudit, AiSettings, Lead, SiteAudit, SiteChecks, SiteVerdict } from "./types";
// FIX (PROBLÈME 1) : infrastructure réseau commune — timeout explicite, retry
// exponentiel, erreurs en français et journalisation console de l'erreur exacte.
import { NetworkError, describeError, fetchWithRetry, fetchWithTimeout, logError, logInfo } from "./net";
// FIX (PROBLÈME 1) : passerelle serveur — la clé Groq reste dans les secrets
// Supabase et ne transite JAMAIS par le navigateur.
import {
  AI_PROXY_DEFAULT_URL,
  AiProxyError,
  DIRECT_AI_KEY_ALLOWED,
  callAiProxy,
  callAiProxyStream,
} from "./aiProxy";

export class AiAgentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /**
     * // FIX (POINT 1) : vrai quand l'échec est une RÉPONSE VIDE. Les modèles
     * de raisonnement (gpt-oss…) consomment leur budget en réflexion avant de
     * rédiger : un budget trop serré renvoie une réponse vide. Dans ce cas on
     * retente UNE fois avec un budget élargi au lieu d'abandonner.
     */
    public readonly needsMoreTokens = false,
  ) {
    super(message);
    this.name = "AiAgentError";
  }
}

/**
 * // FIX (PROBLÈME 1) : 15 s maximum par appel IA (avant : 60 s par défaut,
 * ce qui pouvait bloquer l'interface très longtemps sur réseau mobile).
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * // FIX (PROBLÈME 3) : modèle PRINCIPAL demandé (rapide et solide pour les
 * rapports rédigés). La fonction Edge bascule AUTOMATIQUEMENT sur un modèle de
 * repli si un identifiant n'est plus exposé par Groq — l'analyse ne casse pas.
 */
export const RECOMMENDED_MODEL = "llama-3.3-70b-versatile";
/**
 * // FIX (PROBLÈME 3) : modèle RAPIDE pour les étapes simples (découverte de
 * site, plan d'action JSON) — réponse nettement plus rapide.
 */
const FAST_MODEL_ID = "llama-3.1-8b-instant";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatChoice {
  message?: { content?: string };
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

/** Strip <think>…</think> blocks emitted by reasoning models (DeepSeek-R1 distills). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Unclosed think block (truncated generation): drop everything after the tag.
  const open = out.toLowerCase().indexOf("<think>");
  if (open !== -1) {
    out = out.slice(0, open);
  }
  return out.trim();
}

/** Simple JSON extraction from an LLM reply that may include prose or think blocks. */
export function extractJson<T>(text: string): T {
  const cleaned = stripThinking(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : cleaned).trim();
  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new AiAgentError("Le modèle IA n'a renvoyé aucun objet JSON exploitable.");
  }
  // Try progressively smaller suffixes to tolerate trailing prose.
  for (let end = candidate.length; end > start; end--) {
    try {
      return JSON.parse(candidate.slice(start, end)) as T;
    } catch {
      // keep shrinking
    }
  }
  throw new AiAgentError("La réponse JSON du modèle IA n'a pas pu être interprétée.");
}

// ---------------------------------------------------------------------------
// Website-discovery guardrails (anti-hallucination helpers)
// ---------------------------------------------------------------------------

const WEB_BLOCKLIST =
  /facebook\.com|instagram\.com|tripadvisor|linktr\.ee|pagesjaunes|tiktok\.com|twitter\.com|x\.com|justeat|deliveroo|ubereats|thefork|lafourche|yelp\./;

/** Strip accents/case/punctuation so names compare cleanly. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Meaningful words of a venue name, minus filler articles. */
export function nameTokens(name: string): string[] {
  const FILLER = new Set([
    "le", "la", "les", "l", "du", "de", "des", "au", "aux", "a", "chez",
    "che", "the", "of", "and", "et", "bar", "cafe", "café", "restaurant",
    "hotel", "snack", "pizza", "pizzeria", "brasserie", "bistrot", "bistro",
    "local", "coin", "maison",
  ]);
  return normalizeName(name)
    .split(" ")
    .filter((w) => w.length > 2 && !FILLER.has(w));
}

/**
 * Very generic venue names cannot be safely matched to a domain: whatever the
 * model returns would most likely belong to a different business with the
 * same (or a similar) common word in its name.
 */
export function isGenericVenueName(name: string): boolean {
  return nameTokens(name).length === 0;
}

/**
 * Reject "lookalike" domains: the model sometimes grabs a domain that merely
 * CONTAINS the venue name as a substring of an unrelated brand ("Bell" →
 * bell-food.com). A domain is plausible when one of these holds:
 *   a) a distinctive token of the name appears as a whole word
 *      ("Café Bouillet" → bouillet-lyon.fr);
 *   b) the distinctive tokens glued together appear in the host
 *      ("Au Petit Poisson Rouge" → aupetitpoissonrouge.fr);
 *   c) a long (≥6 chars) distinctive token appears as a substring
 *      ("Midori" → midoricafé.fr) — short tokens are never substrings
 *      so "Belle" cannot match "belleville-pizza.fr".
 */
export function plausibleDomainForName(name: string, url: string): boolean {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return false;
  const bare = url
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase()
    .replace(/\.(com|fr|net|eu|org|io|be|ch|de|co\.uk|co)$/, "");
  // a) whole-word token
  if (tokens.some((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(bare))) return true;
  // b) glued distinctive name
  const glued = tokens.join("");
  if (glued.length >= 6 && bare.includes(glued)) return true;
  // c) long distinctive token as substring
  if (tokens.some((t) => t.length >= 6 && bare.includes(t))) return true;
  return false;
}

/**
 * Best-effort reachability probe for a cross-origin website. Browsers block
 * direct fetches to other origins, so we load a favicon-style image with a
 * timeout: if the server responds (even with a non-image), onLoad fires.
 * Also measures response time — a slow site is a sellable problem.
 */
/**
 * // FIX (PROBLÈME 3) : timeout court par défaut (4 s) — consigne « 3-5 s par
 * vérification », et toutes les vérifications tournent en parallèle borné.
 */
export function probeSite(
  url: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; loadMs: number | null }> {
  return new Promise((resolve) => {
    // Node / test environments have no Image constructor.
    if (typeof Image === "undefined") {
      resolve({ ok: false, loadMs: null });
      return;
    }
    let settled = false;
    const started = Date.now();
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, loadMs: ok ? Date.now() - started : null });
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    const img = new Image();
    img.onload = () => done(true);
    img.onerror = () => {
      // An HTTP error page also proves the host is alive and serving.
      done(true);
    };
    img.src = `${url.replace(/\/+$/, "")}/favicon.ico?glf=${Date.now()}`;
  });
}

/**
 * Browser-side technical checks for an EXISTING website: HTTPS, response
 * time, and (best-effort) homepage text via a public reader proxy — direct
 * fetches are blocked by CORS, but Jina's free r.jina.ai endpoint relays the
 * page as plain text, which is enough to judge content quality. If the relay
 * fails or the page is JS-rendered, content fields are marked unreliable and
 * the AI judges on technical signals only.
 */
export async function fetchSiteChecks(
  url: string,
): Promise<SiteChecks & { excerpt: string | null }> {
  const clean = url.replace(/\/+$/, "");
  const https = clean.toLowerCase().startsWith("https://");

  // FIX (PROBLÈME 3) : la sonde technique et la lecture du contenu partent
  // EN PARALLÈLE. Avant : séquentiel (jusqu'à 4 s + 15 s = 19 s par site) ;
  // maintenant : temps ≈ max(4 s, 8 s) grâce aux timeouts courts explicites.
  const [probe, relay] = await Promise.all([
    probeSite(clean, 4000),
    readHomepageText(clean, 8000),
  ]);

  const checks: SiteChecks & { excerpt: string | null } = {
    reachable: probe.ok,
    https,
    loadMs: probe.loadMs,
    title: null,
    contentChars: 0,
    hasContact: false,
    hasSocialLinks: false,
    contentReliable: false,
    excerpt: null,
  };
  if (!relay) return checks;

  checks.title = relay.split("\n").find((l) => l.startsWith("Title:"))?.slice(6).trim() ?? null;
  checks.contentChars = relay.length;
  checks.contentReliable = true;
  checks.excerpt = relay.slice(0, 2500);
  checks.hasContact = /([\w.+-]+@[\w-]+\.[\w.]+)|(^|\D)(\+33|\b0\d[ .-]?\d{2})/m.test(relay);
  checks.hasSocialLinks = /facebook\.com|instagram\.com|tripadvisor|deliveroo|ubereats|justeat/i.test(relay);
  return checks;
}

/**
 * Lecture best-effort du texte de la page d'accueil via le relais public
 * r.jina.ai (un fetch direct serait bloqué par CORS).
 * // FIX (PROBLÈME 1) : toute erreur est loguée — plus aucun échec silencieux.
 */
async function readHomepageText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://r.jina.ai/${url}`,
      { headers: { Accept: "text/plain" } },
      timeoutMs,
    );
    if (!res.ok) {
      logError("siteCheck", new Error(`Relais de lecture : HTTP ${res.status}`), { url });
      return null;
    }
    const text = (await res.text()).trim();
    if (text.length < 80) return null; // page d'erreur du relais, pas un vrai contenu
    return text;
  } catch (err) {
    logError("siteCheck", err, { url, etape: "lecture du contenu" });
    return null;
  }
}

const SYSTEM_AUDIT = `You are "AuditBot", a senior digital-presence consultant for independent food businesses (restaurants, snacks, kebabs, pizzerias, cafés).
You receive raw data about one venue. Your job: assess its digital footprint and produce a sales-oriented opportunity report for an agency selling web services.
Rules:
- Be concrete and quantitative; cite the numbers you were given.
- The data comes from community-maintained OpenStreetMap and may be OUTDATED: a missing website, missing reviews or missing socials in the data does NOT prove the venue lacks them. Always phrase gaps as "not recorded in the data / to verify", never as certainties. If a website IS present in the data, acknowledge it and audit its likely quality instead of claiming it has none.
- If only a social page is recorded instead of a website, call it out.
- Never invent review counts, ratings, addresses or URLs that are not in the data.
- If a field is unknown, work with what is present and flag it as "to verify".
- Output language: match the venue's country (default French — the tool is used for French prospecting).
- Keep the report under 220 words, structured with markdown: a bold verdict line, then bullet points.`;

const SYSTEM_OUTREACH = `You are "OutreachBot", a cold-outreach copywriter for a digital agency targeting independent food businesses.
Write ONE short, non-spammy, personalized first message addressed to the venue owner.
Rules:
- Reference at least two concrete facts about THIS venue (its rating/review situation, missing website, missing hours...).
- No fake claims, no invented numbers, no "Dear Sir/Madam", no guilt-tripping, no exclamation spam.
- End with a soft, low-commitment call to action (e.g. a free 5-point audit offer).
- Output language: match the venue's country (default French).
- Output ONLY the message text, nothing else.`;

const SYSTEM_PLAN = `You are "PlanBot", a service strategist for a digital agency selling to independent food businesses.
Given venue data, list exactly 3 concrete, sellable services with a one-line pitch and a realistic price range in EUR.
Rules:
- Services must map to the venue's actual gaps (e.g. no website -> landing page; unclaimed Google Business Profile -> GBP claim & optimization; no hours online -> hours sync).
- No generic generic fluff ("improve digital presence").
- Output language: match the venue's country (default French).
- Respond with ONLY a JSON object: {"services": ["1. Service — pitch (€price)", "2. ...", "3. ..."]}`;

const SYSTEM_WEBFIND = `You are "WebFindBot", a research assistant that finds the official website of a food business.
You receive raw venue data (name, address, phone, OSM website field if any).
Rules:
- You may propose the venue's likely official domain derived from its distinctive name on the venue's country TLD (e.g. "Le Petit Bouchon" in Lyon -> lepetitbouchon.fr).
- Generic or very common venue names (e.g. "Le local", "Chez Grégoire", "Banette", "Le Bon beurre") almost always lead to WRONG domains owned by other businesses: return null for them.
- NEVER return social networks (facebook.com, instagram.com, linktr.ee, tiktok.com, tripadvisor...) or directory/aggregator pages (pagesjaunes, tripadvisor, deliveroo, ubereats, justeat, thefork...) as the website.
- If the venue already has a real website in the data, return null.
- Rate confidence HONESTLY: "high" ONLY when you actually recall this specific business's website; "low" when you are merely inferring it from the name.
- Respond with ONLY a JSON object: {"website": "https://..." | null, "confidence": "high"|"low"}.`;

const SYSTEM_SITESCAN = `You are "SiteScanBot", a web consultant who judges the quality of a small business's EXISTING website to find concrete, sellable improvement work.
You receive: the site URL, raw browser-side technical checks (reachable, HTTPS, load time, homepage text stats, contact/social presence), and optionally an excerpt of the homepage text.
Rules:
- Judge ONLY on the provided evidence. If contentReliable is false, say the content could not be inspected and base the verdict on technical signals alone — never invent content problems.
- verdict: "good" = modern, fast, informative site — little to sell; "improve" = works but has clear gaps (slow, no mobile menu evidence, thin content, no contact info, no socials, outdated info); "critical" = barely exists as a sales tool (unreachable, very slow >5s, no HTTPS, near-empty or broken page).
- improvements: exactly 3 to 5 CONCRETE actions an agency could be paid for (e.g. "Enable HTTPS certificate", "Compress hero image to cut 3.2s load time", "Add click-to-call phone number and booking link", "Rewrite homepage with menu, hours, reviews"). No generic fluff like "improve SEO".
- If the checks show nothing wrong, say so honestly — a good verdict builds trust too.
- Respond with ONLY a JSON object: {"verdict": "good"|"improve"|"critical", "summary": "1-2 sentences for the salesperson", "improvements": ["...", ...]}`;

/** Bloc d'audit publié au fur et à mesure (affichage progressif). */
export interface AuditPartial {
  gapReport?: string;
  outreach?: string;
  actionPlan?: string[];
  website?: { url: string; verified: boolean } | null;
  warnings?: string[];
}

export interface AuditHooks {
  /** Reçoit l'état partiel de l'audit À CHAQUE bloc prêt (streaming + parallèle). */
  onPartial?: (partial: AuditPartial) => void;
}

interface ChatOptions {
  jsonMode?: boolean;
  timeoutMs?: number;
  /** // FIX (PROBLÈME 3) : max_tokens volontairement limité au strict nécessaire. */
  maxTokens?: number;
  /** // FIX (PROBLÈME 3) : permet de forcer un modèle (étapes simples → modèle rapide). */
  model?: string;
  /**
   * // FIX (POINT 3 — vitesse et fiabilité) : effort de raisonnement des modèles
   * « reasoning » (gpt-oss). En « low », ils dépensent beaucoup moins de jetons
   * en réflexion : réponse plus rapide ET plus de place pour le texte final
   * (un budget consommé par le raisonnement provoque une réponse vide).
   */
  reasoningEffort?: "low" | "medium" | "high";
}

/** Vrai pour les modèles qui raisonnent avant de répondre (gpt-oss, compound). */
export function isReasoningModel(model: string): boolean {
  return /gpt-oss|compound/i.test(model);
}

export class AIAgentService {
  constructor(private settings: AiSettings) {}

  private get baseUrl(): string {
    return this.settings.baseUrl.replace(/\/+$/, "");
  }

  /**
   * // FIX (PROBLÈME 3) : sur Groq, les étapes simples (JSON courts, découverte
   * de site) utilisent un modèle plus rapide que le modèle principal.
   */
  private get fastModel(): string {
    return this.baseUrl.includes("groq") ? FAST_MODEL_ID : this.settings.model;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.settings.apiKey}`,
    };
  }

  /**
   * URL de la fonction Edge Supabase, si elle est configurée (champ Réglages
   * ou variable d'environnement VITE_SUPABASE_FUNCTIONS_URL).
   */
  private get proxyUrl(): string | null {
    const fromSettings = (this.settings.proxyUrl ?? "").trim();
    const url = (fromSettings || AI_PROXY_DEFAULT_URL).replace(/\/+$/, "");
    return url ? url : null;
  }

  /**
   * True si l'analyse peut fonctionner : passerelle Edge configurée (chemin
   * normal) ou, en développement uniquement, clé locale explicitement autorisée.
   */
  get isConfigured(): boolean {
    return Boolean(this.proxyUrl || (DIRECT_AI_KEY_ALLOWED && this.settings.apiKey));
  }

  private buildBody(
    messages: ChatMessage[],
    opts: ChatOptions,
    model: string,
    stream = false,
  ): string {
    return JSON.stringify({
      model,
      messages,
      // FIX (POINT 2 — fiabilité IA) : 0.3 → réponses stables et reproductibles.
      temperature: 0.3,
      max_tokens: Math.min(opts.maxTokens ?? 800, 3_000),
      ...(stream ? { stream: true } : {}),
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      // FIX (POINT 3) : effort de raisonnement réduit pour les étapes courtes.
      ...(isReasoningModel(model)
        ? { reasoning_effort: opts.reasoningEffort ?? (opts.jsonMode ? "low" : "medium") }
        : {}),
    });
  }

  /** // FIX (PROBLÈME 1) : erreurs HTTP traduites en messages FRANÇAIS actionnables. */
  private httpError(status: number, detail: string): AiAgentError {
    if (status === 401) return new AiAgentError("Clé API invalide (401). Vérifiez-la dans ⚙ Réglages.", 401);
    if (status === 403) return new AiAgentError("Accès refusé par le fournisseur IA (403). Vérifiez les droits de votre clé.", 403);
    if (status === 404) return new AiAgentError("Modèle introuvable (404). Choisissez un autre modèle dans ⚙ Réglages.", 404);
    if (status === 429) return new AiAgentError("Limite de débit IA atteinte (429). Réessayez dans quelques secondes.", 429);
    return new AiAgentError(`Le service IA a échoué (HTTP ${status}). ${detail.slice(0, 200)}`, status);
  }

  /**
   * Modèles de repli utilisés quand un identifiant n'est plus exposé par
   * l'API (réponse 404 « model not found »). En mode passerelle, la fonction
   * Edge gère déjà ces replis ; cette chaîne sert au mode développement direct.
   */
  private static readonly MODEL_CHAIN = [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ];
  /** Même principe pour les étapes simples : petit modèle rapide en premier. */
  private static readonly MODEL_CHAIN_FAST = [
    "llama-3.1-8b-instant",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
  ];
  /** Modèle réellement utilisé pour un modèle demandé (évite les 404 répétés). */
  private static readonly resolvedModels = new Map<string, string>();

  private modelsToTry(requested: string): string[] {
    // Passerelle : la fonction Edge essaie déjà les replis (et les mémorise).
    if (this.proxyUrl) return [requested];
    const memo = AIAgentService.resolvedModels.get(requested);
    const chain = /(8b|instant|mini|20b)/i.test(requested)
      ? AIAgentService.MODEL_CHAIN_FAST
      : AIAgentService.MODEL_CHAIN;
    return [requested, ...(memo ? [memo] : []), ...chain, this.settings.model].filter(
      (m, i, all) => m && all.indexOf(m) === i,
    );
  }

  /**
   * // FIX (PROBLÈME 1 & 3) : appel IA avec TIMEOUT explicite (15 s) et
   * RETRY automatique (3 tentatives, 1 s puis 2 s).
   * Toute erreur est loguée avec son contexte : aucun échec silencieux.
   */
  private async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const requested = opts.model ?? this.settings.model;
    const models = this.modelsToTry(requested);
    let lastError: unknown;

    for (const model of models) {
      try {
        const content = await this.chatWithModel(messages, opts, model);
        AIAgentService.resolvedModels.set(requested, model);
        return content;
      } catch (err) {
        lastError = err;
        /**
         * // FIX (PROBLÈME 1 — fiabilité) : si le modèle demandé n'existe plus
         * (404 « model not found »), on bascule sur le repli suivant au lieu
         * de perdre le bloc d'analyse. Les autres erreurs remontent aussitôt.
         */
        if (!(err instanceof AiAgentError && err.status === 404)) throw err;
        logInfo("aiAgent", `Modèle « ${model} » indisponible (404) — repli sur le suivant`);
      }
    }
    throw lastError;
  }

  /**
   * Un appel IA pour un modèle donné (timeout 15 s + 3 tentatives), avec
   * auto-réparation : si le modèle renvoie une réponse VIDE (budget de jetons
   * consommé par la phase de raisonnement), on retente UNE fois en l'élargissant.
   */
  private async chatWithModel(
    messages: ChatMessage[],
    opts: ChatOptions,
    model: string,
  ): Promise<string> {
    const budget = opts.maxTokens ?? 800;
    try {
      return await this.requestOnce(messages, opts, model, budget);
    } catch (err) {
      if (err instanceof AiAgentError && err.needsMoreTokens && budget < 3_000) {
        const bigger = Math.min(3_000, Math.max(900, budget * 3));
        logInfo(
          "aiAgent",
          `Réponse vide avec ${budget} jetons — nouvelle tentative avec ${bigger} jetons`,
        );
        return this.requestOnce(messages, opts, model, bigger);
      }
      throw err;
    }
  }

  /** Un aller-retour réseau vers le modèle, avec un budget de jetons donné. */
  private async requestOnce(
    messages: ChatMessage[],
    opts: ChatOptions,
    model: string,
    budget: number,
  ): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      /**
       * FIX (PROBLÈME 1) : chemin NORMAL — tout appel part vers la fonction Edge
       * Supabase, qui détient la clé côté serveur et gère les tentatives.
       */
      const proxy = this.proxyUrl;
      if (proxy) {
        return await callAiProxy(proxy, {
          model,
          messages,
          maxTokens: budget,
          jsonMode: opts.jsonMode === true,
          reasoningEffort: opts.reasoningEffort ?? (opts.jsonMode ? "low" : "medium"),
        });
      }

      // Mode dégradé (développement uniquement, sans fonction Edge déployée) :
      // la clé est alors dans le navigateur — jamais en production, et il faut
      // l'autoriser explicitement (VITE_ALLOW_DIRECT_AI_KEY=true).
      if (!DIRECT_AI_KEY_ALLOWED || !this.settings.apiKey) {
        throw new AiAgentError(
          "Oups, l'analyse n'est pas encore configurée : renseignez l'URL de la fonction d'analyse dans ⚙ Réglages (voir supabase/README.md).",
        );
      }
      logInfo(
        "aiAgent",
        "Aucune fonction Edge configurée : appel direct à l'API (mode développement explicitement autorisé).",
      );
      const res = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: this.buildBody(messages, { ...opts, maxTokens: budget }, model),
        timeoutMs,
        attempts: 3,
        delays: [1_000, 2_000], // FIX (POINT 1) : 1 s puis 2 s
        label: `IA ${model}`,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw this.httpError(res.status, detail);
      }

      const json = (await res.json()) as ChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (!content?.trim()) {
        // // FIX (POINT 1) : réponse vide → nouvelle tentative avec plus de jetons.
        throw new AiAgentError(
          "Le modèle n'a rien renvoyé (réponse vide). Réessayez, ou choisissez un autre modèle dans ⚙ Réglages.",
          undefined,
          true,
        );
      }
      return content;
    } catch (err) {
      logError("aiAgent", err, { modele: model });
      if (err instanceof AiAgentError) throw err;
      // Les erreurs de la fonction Edge arrivent déjà en français : on les
      // transmet telles quelles pour ne jamais doubler le message.
      if (err instanceof AiProxyError) throw new AiAgentError(err.message, err.status);
      throw new AiAgentError(
        err instanceof NetworkError ? err.message : `Appel IA impossible : ${describeError(err)}`,
      );
    }
  }

  /**
   * // FIX (POINT 2 — fiabilité de l'IA) : JSON robuste. Certains fournisseurs
   * (Groq) échouent par intermittence en mode JSON (`json_validate_failed`) ou
   * renvoient une génération vide quand le budget est trop serré. On tente donc
   * TROIS stratégies avant d'abandonner, et on VALIDE le JSON à chaque fois :
   *   1. mode JSON forcé (response_format json_object) ;
   *   2. texte brut avec extraction de l'objet JSON ;
   *   3. texte brut avec un budget de jetons élargi (modèles de raisonnement).
   */
  private async chatJson<T>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
    const base = opts.maxTokens ?? 400;
    const plans: Array<{ jsonMode: boolean; budget: number }> = [
      { jsonMode: true, budget: base },
      { jsonMode: false, budget: base },
      { jsonMode: false, budget: Math.min(3_000, Math.max(1_200, base * 3)) },
    ];
    let lastError: unknown;
    for (const plan of plans) {
      try {
        const raw = await this.chat(messages, {
          ...opts,
          jsonMode: plan.jsonMode,
          maxTokens: plan.budget,
        });
        return extractJson<T>(raw);
      } catch (err) {
        lastError = err;
        logInfo(
          "aiAgent",
          `Réponse JSON inexploitable (${plan.jsonMode ? "mode JSON" : "texte brut"}, ${plan.budget} jetons) — nouvelle tentative`,
          { cause: describeError(err) },
        );
      }
    }
    throw lastError;
  }

  /**
   * // FIX (PROBLÈME 3) : STREAMING (SSE `stream: true`). Le texte est poussé
   * au fur et à mesure à l'appelant → l'utilisateur voit le rapport s'écrire
   * au lieu d'attendre la fin de la génération.
   * // FIX (PROBLÈME 1) : garde-fou d'inactivité de 15 s (sans jeton reçu).
   */
  private async chatStream(
    messages: ChatMessage[],
    opts: ChatOptions & { onDelta: (fullText: string) => void },
  ): Promise<string> {
    const model = opts.model ?? this.settings.model;

    /**
     * FIX (PROBLÈME 1 & 3) : le STREAMING passe lui aussi par la fonction Edge
     * — la clé ne quitte jamais le serveur. Si la fonction ne peut pas relayer
     * le flux, l'erreur remonte et l'appelant retombe sur un appel classique.
     */
    const proxy = this.proxyUrl;
    if (proxy) {
      try {
        return await callAiProxyStream(
          proxy,
          {
            model,
            messages,
            maxTokens: opts.maxTokens,
            jsonMode: opts.jsonMode === true,
            reasoningEffort: opts.reasoningEffort ?? "low",
          },
          opts.onDelta,
        );
      } catch (err) {
        logError("aiAgent", err, { modele: model, etape: "streaming via la fonction Edge" });
        throw err instanceof AiAgentError
          ? err
          : new AiAgentError(
              err instanceof Error ? err.message : `Flux IA interrompu : ${describeError(err)}`,
            );
      }
    }

    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    };
    try {
      if (!DIRECT_AI_KEY_ALLOWED) {
        throw new AiAgentError(
          "Oups, l'analyse n'est pas encore configurée : renseignez l'URL de la fonction d'analyse dans ⚙ Réglages (voir supabase/README.md).",
        );
      }
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: this.buildBody(messages, opts, model, true),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw this.httpError(res.status, detail);
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
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              opts.onDelta(full);
            }
          } catch {
            /* fragment SSE incomplet — ignoré, le prochain complètera */
          }
        }
      }
      if (!full.trim()) throw new AiAgentError("Le flux de réponse IA était vide.");
      return full;
    } catch (err) {
      logError("aiAgent", err, { modele: model, etape: "streaming" });
      if (err instanceof AiAgentError) throw err;
      throw new AiAgentError(`Streaming IA interrompu : ${describeError(err)}`);
    } finally {
      clearTimeout(idle);
    }
  }

  /** Quick connectivity + key validity check from the Settings modal. */
  async testConnection(): Promise<string> {
    /**
     * FIX (POINT 1) : budget de 200 jetons (au lieu de 10). Les modèles de
     * raisonnement consomment des jetons avant de répondre : un budget trop
     * court renvoyait une réponse VIDE, et le bouton « Enregistrer et tester »
     * annonçait une erreur alors que la connexion fonctionnait.
     */
    const reply = await this.chat(
      [
        { role: "system", content: "You are a connection tester. Reply with exactly: OK" },
        { role: "user", content: "ping" },
      ],
      { timeoutMs: 15_000, maxTokens: 200 },
    );
    return stripThinking(reply).slice(0, 40);
  }

  private static venuePayload(lead: Lead): string {
    const v = lead.venue;
    const e = lead.enrichment;
    return JSON.stringify({
      name: v.name,
      venue_type: v.venueType,
      address: v.address,
      phone: v.phone,
      website: v.website,
      website_is_real_site: e.checks.hasWebsite,
      social_media: e.checks.hasSocial,
      opening_hours_online: v.openHoursRecorded,
      google_rating: e.checks.rating,
      google_review_count: e.checks.reviewCount,
      cuisine: v.cuisine,
      digital_score: e.digitalScore,
      priority_tier: e.priority,
      signals: e.signals,
    });
  }

  /** AI Agent Function 1 — Digital Gap Analysis (Opportunity Report). */
  async analyzeDigitalGap(lead: Lead, onDelta?: (fullText: string) => void): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_AUDIT },
      {
        role: "user",
        content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nProduce the opportunity report now.`,
      },
    ];
    // // FIX (PROBLÈME 3) : STREAMING — le rapport s'écrit sous les yeux de
    // l'utilisateur au lieu d'apparaître d'un bloc après plusieurs secondes.
    if (onDelta) {
      try {
        const streamed = await this.chatStream(messages, {
          maxTokens: 700, // FIX (PROBLÈME 3) : ~220 mots suffisent, pas 1024 jetons.
          onDelta: (text) => onDelta(stripThinking(text)),
        });
        return stripThinking(streamed);
      } catch (err) {
        logInfo("aiAgent", `Streaming indisponible — repli sur appel classique (${describeError(err)})`);
      }
    }
    const content = await this.chat(messages, { maxTokens: 700 });
    return stripThinking(content);
  }

  /** AI Agent Function 2 — Cold Outreach message (SMS / WhatsApp / Email). */
  async generateOutreach(
    lead: Lead,
    channel: "sms" | "whatsapp" | "email",
    onDelta?: (fullText: string) => void,
  ): Promise<string> {
    const channelSpec = {
      sms: "Channel: SMS — max 320 characters, single segment if possible.",
      whatsapp: "Channel: WhatsApp — max 480 characters, 1-2 emoji max, casual-professional.",
      email:
        "Channel: Email — first line formatted as 'Subject: ...', then the body, max 900 characters.",
    }[channel];

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_OUTREACH },
      {
        role: "user",
        content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\n${channelSpec}\n\nWrite the message now.`,
      },
    ];
    // // FIX (PROBLÈME 3) : streaming + max_tokens adapté au canal (SMS court).
    const maxTokens = channel === "sms" ? 200 : 400;
    if (onDelta) {
      try {
        const streamed = await this.chatStream(messages, {
          maxTokens,
          onDelta: (text) => onDelta(stripThinking(text)),
        });
        return stripThinking(streamed);
      } catch (err) {
        logInfo("aiAgent", `Streaming indisponible — repli sur appel classique (${describeError(err)})`);
      }
    }
    return stripThinking(await this.chat(messages, { maxTokens }));
  }

  /** AI Agent Function 3 — Action Plan (3 sellable services as JSON). */
  async generateActionPlan(lead: Lead): Promise<string[]> {
    // // FIX (PROBLÈME 3) : étape SIMPLE → modèle rapide (8b) + 300 jetons max,
    // et repli automatique en texte brut si le mode JSON échoue.
    const parsed = await this.chatJson<{ services?: unknown }>(
      [
        { role: "system", content: SYSTEM_PLAN },
        {
          role: "user",
          content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nReturn the JSON object now.`,
        },
      ],
      { maxTokens: 500, model: this.fastModel },
    );
    const services = Array.isArray(parsed.services) ? parsed.services : [];
    const cleaned = services
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 3);
    if (cleaned.length === 0) {
      throw new AiAgentError("Model did not return any services");
    }
    return cleaned;
  }

  /**
   * AI Agent Function 4 — Website discovery (best-effort, anti-hallucination).
   *
   * Layers of protection against wrong websites:
   *   1. skipped entirely when OSM already records a real website;
   *   2. social/directory/aggregator domains are always rejected;
   *   3. generic venue names ("Le local", "Midori"...) never get a domain —
   *      the LLM is instructed to answer null, and we enforce it locally too;
   *   4. the returned domain must contain a distinctive token of the venue
   *      name ("Bell" → bell-food.com is rejected);
   *   5. verified (green) = high AI confidence AND two consecutive live
   *      probes; a plausible but lower-confidence candidate stays an amber,
   *      clearly-labeled "to confirm" suggestion — never presented as fact.
   */
  async discoverWebsite(lead: Lead): Promise<{ url: string; verified: boolean } | null> {
    // 1. The venue already has a real website — nothing to discover.
    if (lead.enrichment.checks.hasWebsite && lead.venue.website) return null;
    // Generic names can never be safely matched to a domain.
    if (isGenericVenueName(lead.venue.name)) return null;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_WEBFIND },
      {
        role: "user",
        content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nFind the official website now (or null if not certain).`,
      },
    ];
    try {
      // // FIX (PROBLÈME 3) : modèle RAPIDE + 200 jetons (un domaine et un niveau
      // de confiance suffisent) ; repli texte automatique si le JSON échoue.
      // // FIX (fiabilité) : 300 jetons (au lieu de 200) — le mode JSON de Groq
      // renvoyait parfois une génération vide avec un budget trop serré.
      const parsed = await this.chatJson<{ website?: unknown; confidence?: unknown }>(messages, {
        maxTokens: 300,
        model: this.fastModel,
      });
      const url = typeof parsed.website === "string" ? parsed.website.trim() : "";
      if (!url || !/^https?:\/\//i.test(url)) return null;

      // 2. Never accept social/directory links as the official site.
      if (WEB_BLOCKLIST.test(url.toLowerCase())) return null;
      // 4. Domain must actually relate to the venue's distinctive name.
      if (!plausibleDomainForName(lead.venue.name, url)) return null;

      const confidence = parsed.confidence === "high" ? "high" : "low";
      // // FIX (PROBLÈME 3) : UNE seule sonde (4 s) au lieu de deux sondes
      // séquentielles → ~4 s gagnées par prospect analysé.
      const probe = await probeSite(url);
      const verified = confidence === "high" && probe.ok;
      return { url, verified };
    } catch (err) {
      // Best-effort : ne bloque jamais l'audit, mais l'échec est TRACÉ en console.
      logError("aiAgent", err, { etape: "découverte de site", lieu: lead.venue.name });
      return null;
    }
  }

  /**
   * AI Agent Function 5 — Site quality check for a venue that ALREADY has a
   * website. Browser-side technical checks first, homepage text (best-effort,
   * via a public reader relay) when reachable, then the LLM produces a verdict
   * and a list of sellable improvements. Returns null when the site cannot be
   * probed at all or the model output is unusable — never throws.
   */
  async auditWebsiteQuality(lead: Lead): Promise<SiteAudit | null> {
    const url = lead.venue.website;
    if (!url || !lead.enrichment.checks.hasWebsite) return null;

    try {
      const { excerpt, ...checks } = await fetchSiteChecks(url);
      if (!checks.reachable) return null;

      const payload = JSON.stringify({
        url,
        technical_checks: {
          reachable: checks.reachable,
          https: checks.https,
          load_time_ms: checks.loadMs,
          homepage_title: checks.title,
          homepage_text_chars: checks.contentChars,
          contact_info_visible: checks.hasContact,
          social_links_present: checks.hasSocialLinks,
          content_inspectable: checks.contentReliable,
        },
        homepage_excerpt: excerpt ?? undefined,
      });

      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_SITESCAN },
        { role: "user", content: `Site data:\n${payload}\n\nJudge the site quality now.` },
      ];

      // // FIX (PROBLÈME 1 & 3) : timeout plafonné à 15 s, 500 jetons max, et
      // repli texte automatique si le fournisseur refuse le mode JSON.
      const parsed = await this.chatJson<{
        verdict?: unknown;
        summary?: unknown;
        improvements?: unknown;
      }>(messages, { maxTokens: 600 });

      const verdict: SiteVerdict =
        parsed.verdict === "good" || parsed.verdict === "critical" ? parsed.verdict : "improve";
      const summary =
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Évaluation basée sur les contrôles techniques du site.";
      const improvements = Array.isArray(parsed.improvements)
        ? parsed.improvements
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, 5)
        : [];

      return {
        url,
        checks,
        verdict,
        summary,
        improvements,
        generatedAt: new Date().toISOString(),
        model: this.settings.model,
      };
    } catch (err) {
      // Le site-check ne bloque jamais le flux, mais l'erreur exacte est loguée.
      logError("aiAgent", err, { etape: "analyse de site", url });
      return null;
    }
  }

  /**
   * // FIX (PROBLÈME 3) : l'audit complet publie CHAQUE bloc dès qu'il est prêt
   * (affichage progressif) au lieu d'attendre les 4 appels.
   */
  async fullAudit(lead: Lead, hooks: AuditHooks = {}): Promise<AiAudit> {
    const partial: AuditPartial = {};
    const warnings: string[] = [];
    const publish = () => hooks.onPartial?.({ ...partial, warnings: [...warnings] });
    const startedAt = Date.now();

    // // FIX (PROBLÈME 3) : les 4 agents IA tournent en PARALLÈLE (Promise.all).
    const gapTask = this.analyzeDigitalGap(lead, (text) => {
      partial.gapReport = text;
      publish();
    }).then((gapReport) => {
      partial.gapReport = gapReport;
      publish();
      return gapReport;
    });

    const outreachTask = this.generateOutreach(lead, "email", (text) => {
      partial.outreach = text;
      publish();
    })
      .then((outreach) => {
        partial.outreach = outreach;
        publish();
        return outreach;
      })
      // // FIX (PROBLÈME 1) : un échec SECONDAIRE n'annule plus tout l'audit —
      // il devient un avertissement visible + une entrée dans la console.
      .catch((err) => {
        logError("aiAgent", err, { etape: "message de contact", lieu: lead.venue.name });
        warnings.push("Message de contact non généré (erreur IA) — relancez l'audit.");
        publish();
        return "";
      });

    const planTask = this.generateActionPlan(lead)
      .then((actionPlan) => {
        partial.actionPlan = actionPlan;
        publish();
        return actionPlan;
      })
      .catch((err) => {
        logError("aiAgent", err, { etape: "plan d'action", lieu: lead.venue.name });
        warnings.push("Plan d'action non généré (erreur IA).");
        publish();
        return [];
      });

    const siteTask = this.discoverWebsite(lead)
      .then((website) => {
        partial.website = website;
        publish();
        return website;
      })
      .catch((err) => {
        logError("aiAgent", err, { etape: "découverte de site", lieu: lead.venue.name });
        warnings.push("Recherche de site web indisponible.");
        publish();
        return null;
      });

    const [gapReport, outreach, actionPlan, website] = await Promise.all([
      gapTask,
      outreachTask,
      planTask,
      siteTask,
    ]);

    logInfo("aiAgent", `audit complet en ${Date.now() - startedAt} ms`, {
      modele: this.settings.model,
      avertissements: warnings.length,
    });

    return {
      gapReport,
      outreach,
      actionPlan,
      website,
      generatedAt: new Date().toISOString(),
      model: this.settings.model,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}
