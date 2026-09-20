<div align="center">

# 🎯 GeoLead Finder

**Find local businesses with a weak digital presence — and turn them into web-design clients.**

An internal lead-generation & geographical analysis tool: it scans a city via OpenStreetMap, ranks businesses by how weak their digital footprint is, then uses AI (Groq) to generate a full sales audit, cold-outreach message and priced action plan for each prospect.

[![CI](https://github.com/liamjessenne-creator/67777/actions/workflows/ci.yml/badge.svg)](https://github.com/liamjessenne-creator/67777/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Canvas Globe](https://img.shields.io/badge/Landing-Chrome%20Globe-61b8ff)](#)
[![Live demo](https://img.shields.io/badge/demo-geolead--finder.vercel.app-61b8ff)](https://geolead-finder.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-61b8ff.svg)](LICENSE)

**Live:** <https://geolead-finder.vercel.app> · **CI:** typecheck · 46 tests · production build on every push

</div>

## How it works

```
  City search          Overpass scan           Digital scoring           AI audit
 ┌─────────────┐     ┌──────────────┐       ┌───────────────┐      ┌─────────────────┐
 │ "Lyon 4e"   │ ──▶ │ restaurants, │  ──▶  │ website +40   │ ──▶  │ gap report      │
 │ Nominatim + │     │ fast_food,   │       │ reviews  +30  │      │ cold outreach   │
 │ Photon      │     │ cafés, bars… │       │ socials  +30  │      │ 3-service plan  │
 └─────────────┘     └──────────────┘       │ < 40 = TARGET │      │ website finding │
                                            └───────────────┘      └─────────────────┘
```

1. **City scan** — autocomplete a city or district (Nominatim, Photon fallback), then query OpenStreetMap's Overpass API for all `amenity=restaurant / fast_food / cafe / bar / pub` + named bakeries inside that exact area (result cap: 700).
2. **Digital scoring** — every venue gets a `DigitalPresenceScore` (0–100): real website **+40** (a Facebook URL does *not* count), review base **+30**, socials **+30**, phone **+10**, published hours **+10**. Score < 40 → 🔴 **priority target**.
3. **AI deep audit** (Groq, any OpenAI-compatible endpoint) — one click generates a sales-oriented **gap report**, a non-spammy **cold-outreach draft** (SMS/WhatsApp/Email), an **action plan** of 3 priced services, and even **discovers the venue's hidden official website** (verified reachable before being shown).
4. **Workflow** — landing page with an interactive globe, full-screen ranked results page, CSV/JSON export, `localStorage` persistence, built-in legal pages.

## Reliability & performance (hardened)

Every network call is wrapped by a single shared layer (`net.ts`, `aiProxy.ts`); every
AI call goes through the **Supabase Edge Function** so the Groq key never reaches the browser:

| Concern | Implementation |
|---|---|
| **Key never in the browser** | All model calls go through `supabase/functions/groq` (key in Supabase secrets). Without a gateway the app refuses direct calls and says so; a local key only works with the explicit dev flag `VITE_ALLOW_DIRECT_AI_KEY=true` |
| **Explicit timeouts** | 15 s max per call (AbortController); 4 s site probes, 8 s homepage relay |
| **Automatic retries** | 3 attempts, delays **1 s → 2 s → 4 s** (client) plus the same backoff server-side; timeouts/429/5xx retried, 401/404 never |
| **Invalid JSON** | Validated then retried: JSON mode → plain text with extraction → plain text with a wider token budget |
| **Empty replies** | Reasoning models (gpt-oss) can burn the budget before answering: the reply is retried once with a 3× larger budget, and `reasoning_effort` is sent to keep them fast |
| **Unknown model** | A removed model id (404) falls back automatically to the next known one, and the working model is remembered for the session |
| **No silent failure** | Every catch logs the exact error to the console; partial AI failures surface as a visible warning in the audit drawer |
| **Clear French errors** | Timeouts, 429, network loss, unknown model… all translated into actionable French messages, with a one-click **Réessayer** button |
| **Global safety net** | React `ErrorBoundary` — a render crash shows a French recovery screen instead of a blank page |
| **Bounded scan budget** | Overpass: one attempt per mirror (3 total) under a **28 s total budget** — the old worst case was ~90 s |
| **Progressive UI** | Step messages (*"Recherche des commerces…"*, *"Analyse de leur présence internet… x/y"*) + live chronometer; rows appear as they are scored |
| **Streaming** | The gap report and outreach message stream token-by-token into the drawer (SSE, relayed by the Edge Function) |
| **Parallelism** | 4 AI blocks in parallel; site checks 4 at a time; Google Places 6 at a time (bounded concurrency) |
| **Offline fallback** | Last successful scan is restored from localStorage with a *"Résultats en cache"* banner if the network fails |
| **Smaller payloads** | Overpass result cap 3000 → 800, raw OSM tags stripped before being stored (~3× lighter localStorage) |

Measured on a real session (Lyon 3e): **593 venues scanned**, full 4-block AI audit in **~2.3 s**
with zero warnings, including the 404 → fallback hop.

## Landing page & legal

The app opens on a **landing page** with a full-screen **Chrome Cells** WebGL background (liquid-metal cells shader, used as provided) that the rest of the UI is styled around: frosted-glass panels, chrome text gradients, dark scrims for contrast. The hero also features an interactive wireframe globe (pure HTML canvas — rotating dot-matrix Earth with pulsing "internet" arcs; drag to rotate, scroll to zoom, **click it to enter the tool**).

Built-in legal pages (linked in the footer and inside the tool):

| Page | Route | Content |
|---|---|---|
| Mentions légales | `#/mentions-legales` | Éditeur, hébergement, propriété intellectuelle, responsabilité |
| Confidentialité | `#/confidentialite` | RGPD : zéro serveur, localStorage uniquement, services tiers appelés |
| CGU | `#/cgu` | Usages autorisés/interdits (anti-spam, opt-out, ODbL), responsabilité |

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5199
```

The app ships **without a key** (never hard-coded). In production the key lives in a
server-side secret and the browser only talks to a gateway — either the bundled Vercel
function `api/groq.ts` (no extra account needed) or the Supabase Edge Function:

```dotenv
# Vercel gateway (recommended: nothing else to deploy)
GROQ_API_KEY=gsk_…            # server-side only, never VITE_
VITE_SUPABASE_FUNCTIONS_URL=/api/groq
ALLOWED_ORIGIN=https://your-app.vercel.app   # blocks other sites from using your quota

# — or — Supabase Edge Function
VITE_SUPABASE_FUNCTIONS_URL=https://<project>.supabase.co/functions/v1/groq
```

Deployment steps for the Supabase variant: [`supabase/README.md`](supabase/README.md).

**City scan, server side too.** `api/osm.ts` proxies the public Overpass mirrors from the
server: it sends the `User-Agent` their usage policy requires (a browser cannot),
interrogates every mirror in parallel, prunes unused tags (~2× lighter payload for
mobile) and caches the result for 15 minutes. The client tries it automatically when the
in-browser mirrors fail, so a single successful scan serves every visitor afterwards.

For local development
without a deployed function, a browser-side key still works but must be unlocked
explicitly in `.env.local` (or `.env`) — this is the only case where a key touches the
browser, so never set it in production:

```dotenv
VITE_GROQ_API_KEY=gsk_…your key…
VITE_ALLOW_DIRECT_AI_KEY=true
```

You can also paste the gateway URL (or the dev key) once in ⚙ Settings inside the app
(stored in localStorage only). Then: type a city (Enter works too) → **Analyser la zone**
→ the ranked prospect page opens automatically.

**Vercel deploy** — `vercel.json` pins the Vite preset, `npm ci` install and `dist/`.
The two functions in `api/` (`groq.ts`, `osm.ts`) are deployed automatically alongside
the static build. Required environment variables (Settings → Environment Variables, or
`vercel env add`):

| Variable | Scope | Role |
|---|---|---|
| `GROQ_API_KEY` | server | Groq key used by `api/groq.ts` — **never** prefixed with `VITE_` |
| `VITE_SUPABASE_FUNCTIONS_URL` | build | set to `/api/groq` to route the app to the bundled gateway |
| `ALLOWED_ORIGIN` | server | the site's own URL, so other sites cannot spend your Groq quota |

Without them, the city scan still works (public OpenStreetMap APIs, no key) but the
per-business analysis reports that no gateway is configured — by design, the Groq key is
never shipped to the browser.

**No fabricated leads.** The scan only ever lists establishments that exist in
OpenStreetMap. When every mirror and the server gateway fail, the app says so and offers
an **explicit** fallback: *Pistes par l'analyse*, which asks the model for candidate
businesses. Those rows carry `origin: "ia"` and are labelled **non vérifiés** in the
banner, because a language model can name places that do not exist — a fake prospect
list is worse than a clear error.

```bash
npx vercel --prod      # deploy the current folder
```

Other scripts:

```bash
npm run build      # typecheck + production build → dist/
npm test           # scoring-engine unit tests
npm run typecheck
node overpass-test.mjs "Paris"   # validate Overpass queries for a city
```

## Screenshots

| Landing (globe) | Ranked results page |
|---|---|
| Interactive canvas globe — click to enter the tool | Full-width table sorted by weakest digital presence, export buttons, AI website links |

## Configuration (⚙ Settings)

| Setting | Description |
|---|---|
| **LLM API Key** | Groq key (`gsk_…`) — stored in your browser's localStorage only |
| **Base URL** | Default `https://api.groq.com/openai/v1`; works with DeepSeek, Qwen, OpenRouter, local LLMs — any OpenAI-compatible endpoint |
| **Model ID** | Presets verified live against the Groq catalogue (`llama-3.3-70b-versatile` main, `llama-3.1-8b-instant` fast for short JSON steps, then `openai/gpt-oss-120b` / `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `groq/compound-mini`) — or type any custom model ID. If an ID is retired (Groq answers 404), the agent automatically falls back to the next known model and remembers the one that worked. |
| **Analysis gateway** | Public URL of the Edge Function — the recommended setup: it holds the key server-side. |
| **Google Places key** *(optional)* | Enables real Google ratings/review counts during scans |

**Save & Test Connection** validates the key with a dummy prompt.

## Tech stack

React 18 · Vite 5 · TypeScript (strict) · Tailwind CSS · canvas globe (zero map dependencies) · WebGL **Chrome Cells** background · framer-motion (liquid-carve buttons) · react-markdown · Vitest

**Langue & typographie** — the whole interface is in **French**. Type is bundled locally, no CDN: **Sora** for headings and brand, **Manrope** for the interface, **JetBrains Mono** for figures and data.

### Design system

- **Chrome text** — `.text-chrome` / `.text-chrome-live` paint headlines, headers and key figures with a brushed-metal gradient (brushed band + moving sheen).
- **Liquid glass widgets** — `.glass`, `.glass-strong`, `.glass-live` and the `.carve-glass*` button shells: translucent gradient, `backdrop-filter` blur + saturation, lit top edge and an inner bottom shadow.
- **Palette** — chrome/silver ramp for text, **blue ⇄ white animated** (`#61b8ff`) as the single accent (positive states included), **classes Bordeaux** (`#a8283f` / `#d2647c`) for errors and priority targets, discreet **brass** for “to be confirmed”.
- **Provided components**, kept faithful to their source: `GlobeStudy.tsx` (chrome wireframe globe, letters on the continents, click to drop a pin), `LiquidCarveButton.tsx` (buttons), `ChromeCells.tsx` (page background), `LinkPreview.tsx` (site thumbnails on hover **and** inline in the prospect sheet).
- **Site thumbnails** (`thumbnails.ts`) — real page screenshots (JPEG q72) instead of the site's share image, which was frequently a 96 px logo, an SVG or an outright failure. Results are cached in memory + `localStorage`, one request per domain, preloaded on hover, and an unreachable site shows a clean fallback card instead of an empty frame.

## Project layout

Flat on purpose — every file at the root:

```
index.html          App.tsx            aiAgent.ts          ui.tsx
package.json        main.tsx           aiProxy.ts          CitySearch.tsx
vite.config.ts      index.css          net.ts              LeadsTable.tsx
tsconfig.json       types.ts           overpass.ts         AuditDrawer.tsx
tailwind.config.js  storage.ts         geocoding.ts        SettingsModal.tsx
vercel.json         router.ts          enrichment.ts       TopBar.tsx
                    Landing.tsx        places.ts           FiltersPanel.tsx
                    GlobeStudy.tsx     stats.ts            LegalPages.tsx
                    ChromeCells.tsx    export.ts           ErrorBoundary.tsx
                    LiquidCarveButton.tsx  useDebouncedValue.ts
                    LinkPreview.tsx    thumbnails.ts

Tests: net.test.ts · geocoding.test.ts · aiProxy.test.ts · aiAgent.test.ts · enrichment.test.ts
Outils: overpass-test.mjs (valide une requête Overpass pour une ville donnée)
```

Plus the AI gateway: `supabase/functions/groq/index.ts` (see `supabase/README.md`).

## Notes

- **City search** (`geocoding.ts`) chains three independent providers: **Photon** (primary — 0.1–0.2 s, CORS-open, understands districts like “Lyon 3e”, returns an extent), then **Nominatim**, then **Open-Meteo** (GeoNames, not OpenStreetMap at all). Nominatim is kept second on purpose: it sends **no `Access-Control-Allow-Origin` header** (measured), so a normal browser rejects its response — it used to be asked first, wasting a round trip on every keystroke. Results are cached locally for 30 days and every provider result is scan-ready (a bounding box is synthesized from population when the source has none).
- Public APIs are rate-limited — the app retries with backoff and falls back between providers/mirrors automatically. Overpass queries are built two ways (exact area **and** bounding box) and the second is used when the mirrors time out on the first.
- The AI website discovery infers the official domain from the venue's name; verified links were confirmed reachable (blue), unverified ones are plausible but unconfirmed (brass) — hover any of them for a live screenshot of the page (keyboard focus works too, and the prospect sheet embeds the screenshot so it is visible on phones).
- 🔐 **No secrets are committed.** The key lives in `.env.local` (gitignored) or in your browser's localStorage. If you ever leaked a key publicly, rotate it from your [Groq console](https://console.groq.com).

## License

[MIT](LICENSE)
