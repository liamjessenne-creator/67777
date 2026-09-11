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

/**
 * Best-effort reachability probe for a cross-origin website. Browsers block
 * direct fetches to other origins, so we load a favicon-style image with a
 * timeout: if the server responds (even with a non-image), onLoad fires.
 */
export function probeSite(url: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
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
- If the data shows NO website, say it explicitly and quantify the impact.
- If only a social page exists instead of a website, call it out.
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
- Infer the most plausible official domain from the venue name (e.g. "Le Petit Bouchon" in Lyon -> lepetitbouchon.fr or lepetitbouchon-lyon.fr). Prefer the venue's country TLD.
- NEVER return social networks (facebook.com, instagram.com, linktr.ee, tripadvisor...) as the website.
- NEVER return directory pages (pagesjaunes, tripadvisor, lafourche...).
- If you truly cannot infer a plausible official domain, return null.
- Respond with ONLY a JSON object: {"website": "https://..." | null, "confidence": "high"|"low"}`;

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
   * AI Agent Function 4 — Website discovery.
   * The LLM infers the most plausible official domain, then we verify it is
   * actually reachable from the browser (cross-origin sites can't be fetched,
   * so we probe by loading a favicon-style image with a timeout).
   */
  async discoverWebsite(lead: Lead): Promise<{ url: string; verified: boolean } | null> {
    try {
      const raw = await this.chat(
        [
          { role: "system", content: SYSTEM_WEBFIND },
          {
            role: "user",
            content: `Venue data:\n${AIAgentService.venuePayload(lead)}\n\nFind the official website now.`,
          },
        ],
        { jsonMode: true, timeoutMs: 20_000, maxTokens: 200 },
      );
      const parsed = extractJson<{ website?: unknown }>(raw);
      const url = typeof parsed.website === "string" ? parsed.website.trim() : "";
      if (!url || !/^https?:\/\//i.test(url)) return null;

      // Never accept social/directory links as the official site
      const u = url.toLowerCase();
      if (/facebook\.com|instagram\.com|tripadvisor|linktr\.ee|pagesjaunes/.test(u)) {
        return null;
      }
      const verified = await probeSite(url);
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
