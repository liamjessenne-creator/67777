/**
 * AIAgentService — prompt-engineered audit engine against any OpenAI-compatible
 * endpoint (Groq by default, also DeepSeek/Qwen OpenAI-mode endpoints).
 */

import type { AiAudit, AiSettings, Lead } from "./types";

export class AiAgentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiAgentError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

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
    throw new AiAgentError("Model returned no JSON object");
  }
  // Try progressively smaller suffixes to tolerate trailing prose.
  for (let end = candidate.length; end > start; end--) {
    try {
      return JSON.parse(candidate.slice(start, end)) as T;
    } catch {
      // keep shrinking
    }
  }
  throw new AiAgentError("Model JSON could not be parsed");
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
 */
export function probeSite(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    // Node / test environments have no Image constructor.
    if (typeof Image === "undefined") {
      resolve(false);
      return;
    }
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
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

const SYSTEM_AUDIT = `You are "AuditBot", a senior digital-presence consultant for independent food businesses (restaurants, snacks, kebabs, pizzerias, cafés).
You receive raw data about one venue. Your job: assess its digital footprint and produce a sales-oriented opportunity report for an agency selling web services.
Rules:
- Be concrete and quantitative; cite the numbers you were given.
- The data comes from community-maintained OpenStreetMap and may be OUTDATED: a missing website, missing reviews or missing socials in the data does NOT prove the venue lacks them. Always phrase gaps as "not recorded in the data / to verify", never as certainties. If a website IS present in the data, acknowledge it and audit its likely quality instead of claiming it has none.
- If only a social page is recorded instead of a website, call it out.
- Never invent review counts, ratings, addresses or URLs that are not in the data.
- If a field is unknown, work with what is present and flag it as "to verify".
- Output language: match the venue's country (default English).
- Keep the report under 220 words, structured with markdown: a bold verdict line, then bullet points.`;

const SYSTEM_OUTREACH = `You are "OutreachBot", a cold-outreach copywriter for a digital agency targeting independent food businesses.
Write ONE short, non-spammy, personalized first message addressed to the venue owner.
Rules:
- Reference at least two concrete facts about THIS venue (its rating/review situation, missing website, missing hours...).
- No fake claims, no invented numbers, no "Dear Sir/Madam", no guilt-tripping, no exclamation spam.
- End with a soft, low-commitment call to action (e.g. a free 5-point audit offer).
- Output language: match the venue's country (default English).
- Output ONLY the message text, nothing else.`;

const SYSTEM_PLAN = `You are "PlanBot", a service strategist for a digital agency selling to independent food businesses.
Given venue data, list exactly 3 concrete, sellable services with a one-line pitch and a realistic price range in EUR.
Rules:
- Services must map to the venue's actual gaps (e.g. no website -> landing page; unclaimed Google Business Profile -> GBP claim & optimization; no hours online -> hours sync).
- No generic generic fluff ("improve digital presence").
- Output language: match the venue's country (default English).
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

interface ChatOptions {
  jsonMode?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
}

export class AIAgentService {
  constructor(private settings: AiSettings) {}

  private get baseUrl(): string {
    return this.settings.baseUrl.replace(/\/+$/, "");
  }

  private async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages,
          temperature: 0.4,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = "";
        try {
          detail = await res.text();
        } catch {
          /* ignore */
        }
        if (res.status === 401) {
          throw new AiAgentError("Invalid API key (401). Check it in Settings.", 401);
        }
        if (res.status === 429) {
          throw new AiAgentError("Rate limit (429). Wait a moment and retry.", 429);
        }
        throw new AiAgentError(
          `LLM request failed (${res.status}). ${detail.slice(0, 300)}`,
          res.status,
        );
      }

      const json = (await res.json()) as ChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new AiAgentError("Model returned an empty response");
      }
      return content;
    } catch (err) {
      if (err instanceof AiAgentError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AiAgentError("Request timed out");
      }
      throw new AiAgentError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Quick connectivity + key validity check from the Settings modal. */
  async testConnection(): Promise<string> {
    const reply = await this.chat(
      [
        { role: "system", content: "You are a connection tester. Reply with exactly: OK" },
        { role: "user", content: "ping" },
      ],
      { timeoutMs: 15_000, maxTokens: 10 },
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
  async analyzeDigitalGap(lead: Lead): Promise<string> {
    const content = await this.chat([
      { role: "system", content: SYSTEM_AUDIT },
      {
        role: "user",
        content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nProduce the opportunity report now.`,
      },
    ]);
    return stripThinking(content);
  }

  /** AI Agent Function 2 — Cold Outreach message (SMS / WhatsApp / Email). */
  async generateOutreach(
    lead: Lead,
    channel: "sms" | "whatsapp" | "email",
  ): Promise<string> {
    const channelSpec = {
      sms: "Channel: SMS — max 320 characters, single segment if possible.",
      whatsapp: "Channel: WhatsApp — max 480 characters, 1-2 emoji max, casual-professional.",
      email:
        "Channel: Email — first line formatted as 'Subject: ...', then the body, max 900 characters.",
    }[channel];

    const content = await this.chat([
      { role: "system", content: SYSTEM_OUTREACH },
      {
        role: "user",
        content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\n${channelSpec}\n\nWrite the message now.`,
      },
    ]);
    return stripThinking(content);
  }

  /** AI Agent Function 3 — Action Plan (3 sellable services as JSON). */
  async generateActionPlan(lead: Lead): Promise<string[]> {
    const raw = await this.chat(
      [
        { role: "system", content: SYSTEM_PLAN },
        {
          role: "user",
          content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nReturn the JSON object now.`,
        },
      ],
      { jsonMode: true },
    );
    const parsed = extractJson<{ services?: unknown }>(raw);
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
      let raw: string;
      try {
        raw = await this.chat(messages, {
          jsonMode: true,
          timeoutMs: 20_000,
          maxTokens: 200,
        });
      } catch {
        // Some providers (Groq) intermittently fail JSON mode with an empty
        // generation; retry once in plain mode — extractJson tolerates prose
        // wrapped around the JSON object.
        raw = await this.chat(messages, { timeoutMs: 20_000, maxTokens: 300 });
      }
      const parsed = extractJson<{ website?: unknown; confidence?: unknown }>(raw);
      const url = typeof parsed.website === "string" ? parsed.website.trim() : "";
      if (!url || !/^https?:\/\//i.test(url)) return null;

      // 2. Never accept social/directory links as the official site.
      if (WEB_BLOCKLIST.test(url.toLowerCase())) return null;
      // 4. Domain must actually relate to the venue's distinctive name.
      if (!plausibleDomainForName(lead.venue.name, url)) return null;

      const confidence = parsed.confidence === "high" ? "high" : "low";
      // 5. Verified = confident claim + two consecutive reachable probes.
      const verified =
        confidence === "high" && (await probeSite(url)) && (await probeSite(url));
      return { url, verified };
    } catch {
      return null; // website discovery is best-effort, never blocks the audit
    }
  }

  /** Convenience: run the full audit (gap + outreach + plan + website). */
  async fullAudit(lead: Lead): Promise<AiAudit> {
    const [gapReport, outreach, actionPlan, website] = await Promise.all([
      this.analyzeDigitalGap(lead),
      this.generateOutreach(lead, "email"),
      this.generateActionPlan(lead),
      this.discoverWebsite(lead),
    ]);
    return {
      gapReport,
      outreach,
      actionPlan,
      website,
      generatedAt: new Date().toISOString(),
      model: this.settings.model,
    };
  }
}
