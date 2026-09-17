/** Barre supérieure : marque, état du service, statistiques, réglages. */

import { Settings, Store } from "lucide-react";
import type { Stats } from "./stats";
import { StatChip } from "./ui";

export function TopBar({
  stats,
  onOpenSettings,
  settingsOk,
  onHome,
}: {
  stats: Stats;
  onOpenSettings: () => void;
  settingsOk: boolean;
  onHome?: () => void;
}) {
  return (
    <header className="flex items-center gap-4 border-b border-white/10 bg-slate-950/70 px-4 py-2.5 backdrop-blur-md">
      <button
        onClick={onHome}
        className="flex shrink-0 items-center gap-2.5 text-left"
        title={onHome ? "Retour à l'accueil" : undefined}
      >
        <span className="liquid-edge flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-accent shadow-glow-sm">
          <Store size={16} />
        </span>
        <div className="leading-tight">
          <h1 className="text-chrome-live font-display whitespace-nowrap text-[15px] font-semibold tracking-tight">
            GeoLead Finder
          </h1>
          <p className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:block">
            Prospection locale
          </p>
        </div>
      </button>

      {/* État du service */}
      <span
        className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider sm:inline-flex ${
          settingsOk
            ? "border-accent/45 bg-accent/12 text-emerald-200 backdrop-blur-md"
            : "border-amber-400/50 bg-amber-500/10 text-amber-300 backdrop-blur-md"
        }`}
        title={
          settingsOk
            ? "Modèle d'analyse connecté"
            : "Ajoutez une clé API dans les réglages pour lancer les analyses"
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${settingsOk ? "dot-accent" : "bg-amber-400"}`}
        />
        {settingsOk ? "Connecté" : "Clé manquante"}
      </span>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <StatChip label="Analysés" value={stats.totalAnalyzed} tone="slate" />
        {/* Sur écran étroit, seuls les indicateurs essentiels restent visibles. */}
        <span className="hidden items-center gap-2 md:flex">
          <StatChip label="Cibles" value={stats.highPriority} tone="red" />
          <StatChip label="Qualifiés" value={stats.qualifiedLeads} tone="emerald" />
        </span>
        <button
          onClick={onOpenSettings}
          title="Réglages"
          className={`shrink-0 rounded-lg border p-2 transition-colors ${
            settingsOk
              ? "border-white/10 text-slate-400 hover:text-accent"
              : "border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
          }`}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
