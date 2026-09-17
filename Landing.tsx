/**
 * Page d'accueil — globe interactif, présentation des fonctions et pied de page
 * avec les liens légaux (mentions légales, confidentialité, CGU).
 *
 * Le fond animé ChromeCells (composant fourni) est utilisé tel quel, plein écran.
 */

import { ArrowRight, Download, FileText, ListOrdered, Radar, Store } from "lucide-react";
import { Globe } from "./Globe";
import ChromeCells from "./ChromeCells";

interface Props {
  onEnter: () => void;
}

const FEATURES = [
  {
    icon: <Radar size={16} />,
    title: "Analyse de zone",
    text: "Saisissez une ville ou un quartier : tous les restaurants, snacks, cafés, boulangeries et bars sont récupérés depuis OpenStreetMap, avec un plafond pour rester ciblé et rapide.",
  },
  {
    icon: <Store size={16} />,
    title: "Score de présence numérique",
    text: "Chaque établissement est noté de 0 à 100 : site web +40, avis +30, réseaux sociaux +30, téléphone et horaires +10. Sous 40, c'est une cible prioritaire.",
  },
  {
    icon: <ListOrdered size={16} />,
    title: "Liste de prospects classée",
    text: "Résultats classés par présence numérique la plus faible, filtres par type de commerce, numéro de téléphone et export CSV / JSON pour votre suivi commercial.",
  },
  {
    icon: <FileText size={16} />,
    title: "Fiche de prospection",
    text: "Pour chaque cible : rapport de présence numérique, message de premier contact prêt à envoyer et plan d'action en trois prestations chiffrées en euros.",
  },
];

export function Landing({ onEnter }: Props) {
  return (
    <div className="relative flex min-h-full flex-col">
      {/* Fond ChromeCells fourni, plein écran, avec voile de lisibilité. */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <ChromeCells style={{ minWidth: 0, minHeight: 0 }} />
        <div className="absolute inset-0 bg-slate-950/70" />
      </div>

      <div className="relative z-10 flex min-h-full flex-col">
        {/* ---- En-tête sobre ---- */}
        <header className="flex h-14 items-center gap-3 border-b border-white/10 bg-slate-950/60 px-6 backdrop-blur-md">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Store size={16} />
          </span>
          <div className="leading-tight">
            <h1 className="text-chrome-live font-display text-sm font-semibold tracking-tight">
              GeoLead Finder
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-slate-500">
              Prospection locale
            </p>
          </div>
          <nav className="ml-auto flex items-center gap-4 text-xs text-slate-400">
            <a href="#/mentions-legales" className="hidden hover:text-accent sm:inline">
              Mentions légales
            </a>
            <a href="#/confidentialite" className="hidden hover:text-accent sm:inline">
              Confidentialité
            </a>
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

        {/* ---- Section principale ---- */}
        <section className="relative flex min-h-[calc(100vh-56px)] flex-col overflow-hidden">
          <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-6 py-10 lg:grid-cols-2">
            <div className="max-w-xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]">
              <h1 className="text-chrome text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Trouvez les commerces{" "}
                {/* Accent VIVANT : bleu ⇄ blanc animé (ancien dégradé vert/teal). */}
                <span className="text-accent-live">absents du web</span>.
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-300">
                GeoLead Finder analyse une ville, note la présence numérique de chaque
                restaurant, snack ou café, et vous livre une liste de prospects classée :
                ceux qui n'ont ni site web, ni avis, ni réseaux sociaux. Vous repartez avec
                le rapport, le message de contact et le plan d'action pour chacun.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  onClick={onEnter}
                  className="accent-live liquid-edge inline-flex items-center gap-2 rounded-xl border border-white/25 px-6 py-3 text-sm font-semibold shadow-glow transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                  Ouvrir l'outil <ArrowRight size={16} />
                </button>
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  ou cliquez sur le globe
                </span>
              </div>
              <dl className="mt-9 grid max-w-md grid-cols-3 gap-3 font-mono">
                {[
                  ["700+", "commerces / analyse"],
                  ["0–100", "score de présence"],
                  ["CSV / JSON", "export des résultats"],
                ].map(([v, l]) => (
                  <div key={l} className="glass glass-sheen rounded-xl px-3 py-2.5">
                    <dt className="text-accent-live text-base font-bold">{v}</dt>
                    <dd className="text-[9px] uppercase tracking-widest text-slate-500">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Globe — interactif */}
            <div className="relative h-[46vh] min-h-[320px] lg:h-[70vh]">
              <Globe onEnter={onEnter} focus />
              <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
                faire glisser · cliquer pour entrer
              </span>
            </div>
          </div>
        </section>

        {/* ---- Fonctions ---- */}
        <section className="border-t border-white/10 bg-black/35 backdrop-blur-md">
          <div className="mx-auto grid max-w-7xl gap-4 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="glass glass-live rounded-2xl p-5 transition-all hover:border-accent/45 hover:shadow-glow-sm"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-accent shadow-glow-sm">
                  {f.icon}
                </span>
                <h3 className="text-chrome mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Pied de page ---- */}
        <footer className="border-t border-white/10 bg-black/55 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-6 text-xs text-slate-500 sm:flex-row sm:items-center">
            <p>
              <span className="font-semibold text-slate-300">GeoLead Finder</span> — outil de
              prospection locale. Données © contributeurs OpenStreetMap (ODbL). Les rapports et
              messages sont indicatifs et doivent être vérifiés avant tout démarchage.
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
    </div>
  );
}
