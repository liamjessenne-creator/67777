/**
 * Landing page — interactive globe hero, feature grid and footer with the
 * legal links (mentions légales, confidentialité, CGU).
 */

import {
  ArrowRight,
  Bot,
  Download,
  Radar,
  ScanSearch,
  Trophy,
} from "lucide-react";
import { Globe } from "./Globe";

interface Props {
  onEnter: () => void;
}

const FEATURES = [
  {
    icon: <Radar size={16} />,
    title: "City scan",
    text: "Autocomplete any city or district and pull every restaurant, snack, café, bakery, bar and pub from OpenStreetMap — capped, targeted, fast.",
  },
  {
    icon: <ScanSearch size={16} />,
    title: "Digital footprint scoring",
    text: "Each venue is scored 0–100: website +40, reviews +30, socials +30, phone +10. Anything under 40 becomes a priority target.",
  },
  {
    icon: <Trophy size={16} />,
    title: "Ranked prospect list",
    text: "Full-screen results page sorted by weakest digital presence first, with filters, phone numbers and export to CSV / JSON.",
  },
  {
    icon: <Bot size={16} />,
    title: "AI deep audit",
    text: "One click generates a gap report, a ready-to-send outreach message and 3 priced services to pitch — and even discovers hidden official websites.",
  },
];

export function Landing({ onEnter }: Props) {
  return (
    <div className="flex min-h-full flex-col">
      {/* ---- Slim header ---- */}
      <header className="flex h-14 items-center gap-3 border-b border-surface-border bg-surface-raised/80 px-6 backdrop-blur">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent/25 to-accent/5 text-accent shadow-glow-sm ring-1 ring-accent/30">
          <Radar size={16} />
        </span>
        <div className="leading-tight">
          <h1 className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-200 bg-clip-text text-sm font-bold tracking-tight text-transparent">
            GeoLead Finder AI
          </h1>
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">
            Prospecting intelligence
          </p>
        </div>
        <nav className="ml-auto flex items-center gap-4 text-xs text-slate-400">
          <a href="#/mentions-legales" className="hidden hover:text-accent sm:inline">Mentions légales</a>
          <a href="#/confidentialite" className="hidden hover:text-accent sm:inline">Confidentialité</a>
          <a
            href="https://github.com/liamjessenne-creator/67777"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 hover:text-accent"
          >
            GitHub <Download size={11} className="rotate-180" />
          </a>
        </nav>
      </header>

      {/* ---- Hero ---- */}
      <section className="bg-grid relative flex min-h-[calc(100vh-56px)] flex-col overflow-hidden">
        <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-6 py-10 lg:grid-cols-2">
          {/* Copy — left */}
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
              Prospecting intelligence
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-slate-50 sm:text-5xl">
              Find the businesses the{" "}
              <span className="bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent">
                internet forgot
              </span>
              .
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              GeoLead Finder AI scans a city, scores every restaurant and café's
              digital presence, and hands you a ranked hit-list of prospects with
              no website, no reviews and no socials — the perfect clients for
              your web services. An AI agent writes the pitch for you.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={onEnter}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-slate-950 shadow-glow transition-all hover:bg-accent-soft hover:shadow-glow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                Launch the tool <ArrowRight size={16} />
              </button>
              <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                or click the globe →
              </span>
            </div>
            <dl className="mt-9 grid max-w-md grid-cols-3 gap-3 font-mono">
              {[
                ["700+", "venues / scan"],
                ["0–100", "digital score"],
                ["3+1", "AI sales outputs"],
              ].map(([v, l]) => (
                <div
                  key={l}
                  className="rounded-lg border border-surface-border bg-surface-raised/70 px-3 py-2.5 backdrop-blur"
                >
                  <dt className="text-lg font-bold text-emerald-400">{v}</dt>
                  <dd className="text-[9px] uppercase tracking-widest text-slate-500">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Globe — right (interactive) */}
          <div className="relative h-[46vh] min-h-[320px] lg:h-[70vh]">
            <Globe onEnter={onEnter} focus />
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-slate-600">
              drag · scroll · click to enter
            </span>
          </div>
        </div>
      </section>

      {/* ---- Features ---- */}
      <section className="border-t border-surface-border bg-surface-raised/40">
        <div className="mx-auto grid max-w-7xl gap-4 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-surface-border bg-surface-raised p-5 transition-all hover:border-accent/40 hover:shadow-glow-sm"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/30">
                {f.icon}
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-100">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-surface-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>
            <span className="font-semibold text-slate-300">GeoLead Finder AI</span> — open-source
            prospecting tool. Data © OpenStreetMap contributors (ODbL). AI by your own
            OpenAI-compatible endpoint.
          </p>
          <nav className="flex flex-wrap gap-4 sm:ml-auto">
            <a href="#/mentions-legales" className="transition-colors hover:text-accent">
              Mentions légales
            </a>
            <a href="#/confidentialite" className="transition-colors hover:text-accent">
              Confidentialité
            </a>
            <a href="#/cgu" className="transition-colors hover:text-accent">
              CGU
            </a>
            <a
              href="https://github.com/liamjessenne-creator/67777"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 transition-colors hover:text-accent"
            >
              GitHub <Download size={11} className="rotate-180" />
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
