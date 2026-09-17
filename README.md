<div align="center">

# 🎯 GeoLead Finder AI

**Find local businesses with a weak digital presence — and turn them into web-design clients.**

An internal lead-generation & geographical analysis tool: it scans a city via OpenStreetMap, ranks businesses by how weak their digital footprint is, then uses AI (Groq) to generate a full sales audit, cold-outreach message and priced action plan for each prospect.

[![CI](https://github.com/liamjessenne-creator/67777/actions/workflows/ci.yml/badge.svg)](https://github.com/liamjessenne-creator/67777/actions/workflows/ci.yml)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Canvas Globe](https://img.shields.io/badge/Landing-Interactive%20Globe-10b981)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)

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

The app ships **without a key** (never hard-coded). In production the key lives in the
**Supabase secrets** and the browser only talks to the Edge Function:

```dotenv
VITE_SUPABASE_FUNCTIONS_URL=https://<project>.supabase.co/functions/v1/groq
```

Deployment steps: [`supabase/README.md`](supabase/README.md). For local development
without a deployed function, a browser-side key still works but must be unlocked
explicitly in `.env.local` (or `.env`) — this is the only case where a key touches the
browser, so never set it in production:

```dotenv
VITE_GROQ_API_KEY=gsk_…your key…
VITE_ALLOW_DIRECT_AI_KEY=true
```

You can also paste the gateway URL (or the dev key) once in ⚙ Settings inside the app
(stored in localStorage only). Then: pick a city → **Analyse** → the ranked prospect page
opens automatically.

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

React 18 · Vite 5 · TypeScript (strict) · Tailwind CSS · HTML-canvas globe (zero map dependencies) · WebGL **Chrome Cells** background · react-markdown · Vitest

**Langue & typographie** — the whole interface is in **French**. Type is bundled locally (no CDN): **Sora** for headings and brand, **Manrope** for the interface, **JetBrains Mono** for figures and data.

## Project layout

Flat on purpose — every file at the root:

```
index.html          App.tsx            aiAgent.ts          ui.tsx
package.json        main.tsx           overpass.ts         CitySearch.tsx
vite.config.ts      index.css          enrichment.ts       LeadsTable.tsx
tsconfig.json       types.ts           nominatim.ts        AuditDrawer.tsx
tailwind.config.js  storage.ts         places.ts           SettingsModal.tsx
                    router.ts          stats.ts            TopBar.tsx
                    Globe.tsx          export.ts           FiltersPanel.tsx
                    Landing.tsx        useDebouncedValue.ts
                    LegalPages.tsx
                    enrichment.test.ts  overpass-test.mjs
```

## Notes

- Public APIs (Nominatim, Photon, Overpass) are rate-limited — the app retries with backoff and falls back between mirrors/geocoders automatically.
- The AI website discovery infers the official domain from the venue's name; verified (green ✓) links were confirmed reachable, unverified (blue ?) ones are plausible but unconfirmed.
- 🔐 **No secrets are committed.** The key lives in `.env.local` (gitignored) or in your browser's localStorage. If you ever leaked a key publicly, rotate it from your [Groq console](https://console.groq.com).

## License

[MIT](LICENSE)
