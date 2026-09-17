/**
 * Page d'accueil — globe interactif, présentation des fonctions et pied de page
 * avec les liens légaux (mentions légales, confidentialité, CGU).
 *
 * Le fond animé ChromeCells (composant fourni) est utilisé tel quel, plein écran.
 * Le globe est le composant fourni **Globe Study**, utilisé tel quel, en palette
 * chrome (argent métallique) et sur une colonne ÉLARGIE.
 */

import { ArrowRight, Download, FileText, ListOrdered, Radar, Store } from "lucide-react";
import GlobeStudy from "./GlobeStudy";
import ChromeCells from "./ChromeCells";
import { Button } from "./ui";

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
          {/*
           * Colonne du globe nettement plus large que le texte
           * (≈ 1,85 contre 1 en grand écran) : le globe occupe l'espace.
           */}
          <div className="relative z-10 mx-auto grid w-full max-w-[110rem] flex-1 items-center gap-8 px-6 py-8 lg:grid-cols-[minmax(0,0.54fr)_minmax(0,1.46fr)] lg:gap-8">
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
                <Button size="lg" variant="primary" onClick={onEnter}>
                  Ouvrir l'outil <ArrowRight size={16} />
                </Button>
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

            {/*
             * Globe Study (composant fourni, utilisé tel quel) en palette chrome :
             * fond transparent pour laisser voir le shader ChromeCells, points et
             * lettres en argent métallique. `style` neutralise seulement le
             * minWidth/minHeight du conteneur du composant (débordement mobile).
             */}
            <div
              className="relative h-[58vh] min-h-[400px] w-full cursor-grab active:cursor-grabbing sm:h-[64vh] lg:h-[94vh] lg:min-h-[660px]"
              onDoubleClick={onEnter}
              title="Double-cliquez pour ouvrir l'outil"
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(58% 52% at 50% 46%, rgba(97,184,255,0.16), transparent 68%)",
                }}
              />
              <GlobeStudy
                width={undefined}
                height={undefined}
                background="transparent"
                /* Encre CHROME : argent froid, légèrement bleuté. */
                baseColor="#dce4ef"
                phrase="trouvezlescommercesabsentsduweb"
                density={54}
                glyphSize={92}
                speed={100}
                hover={100}
                globe={{ drift: 210, radius: 118, letters: 100 }}
                pointer={{ zoom: 100, light: 115, pins: 9 }}
                style={{ minWidth: 0, minHeight: 0, width: "100%", height: "100%" }}
              />
              {/*
               * Voile CHROME : bandes claires/sombres en mode `overlay`, masquées
               * en cercle sur la sphère — c'est ce qui donne l'aspect métal poli
               * au globe (l'encre du composant est monochrome, le reflet vient d'ici).
               */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(148deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.05) 15%, rgba(4,8,14,0.78) 33%, rgba(255,255,255,0.48) 50%, rgba(4,8,14,0.66) 68%, rgba(255,255,255,0.26) 84%, rgba(4,8,14,0.35) 100%)",
                  mixBlendMode: "overlay",
                  WebkitMaskImage:
                    "radial-gradient(circle at 50% 54%, #000 30%, rgba(0,0,0,0.5) 38%, transparent 45%)",
                  maskImage:
                    "radial-gradient(circle at 50% 54%, #000 30%, rgba(0,0,0,0.5) 38%, transparent 45%)",
                }}
              />
              {/* Liseré chromé sur le limbe de la sphère. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 50% 54%, transparent 32%, rgba(255,255,255,0.16) 40%, rgba(255,255,255,0.04) 43%, transparent 46%)",
                  mixBlendMode: "screen",
                }}
              />
              <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
                faire glisser · molette pour zoomer · clic pour planter un repère · double-clic pour entrer
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
