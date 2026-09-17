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

## Landing page & legal

The app opens on a **landing page** featuring an interactive wireframe globe (pure HTML canvas — rotating dot-matrix Earth with pulsing "internet" arcs; drag to rotate, scroll to zoom, **click it to enter the tool**).

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

By default the app ships **without a key**: create a `.env.local` file (gitignored) with your Groq key:

```dotenv
VITE_GROQ_API_KEY=gsk_…your key…
```

…or simply paste the key once in ⚙ Settings inside the app (stored in localStorage only). Then: pick a city → **Analyze Area** → the ranked prospect page opens automatically.

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
| **Model ID** | Presets verified live against Groq (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `groq/compound-mini`) — or type any custom model ID |
| **Google Places key** *(optional)* | Enables real Google ratings/review counts during scans |

**Save & Test Connection** validates the key with a dummy prompt.

## Tech stack

React 18 · Vite 5 · TypeScript (strict) · Tailwind CSS · HTML-canvas globe (zero map dependencies) · react-markdown · Vitest

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
