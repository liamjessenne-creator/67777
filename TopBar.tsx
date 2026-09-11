/** Top navigation bar: brand, system status, quick stats, settings. */

import { Settings, Sparkles } from "lucide-react";
import type { Stats } from "./stats";
import { StatChip } from "./ui";

export function TopBar({
  stats,
  onOpenSettings,
  settingsOk,
}: {
  stats: Stats;
  onOpenSettings: () => void;
  settingsOk: boolean;
}) {
  return (
    <header className="flex items-center gap-4 border-b border-surface-border bg-surface-raised/90 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent/25 to-accent/5 text-accent shadow-glow-sm ring-1 ring-accent/30">
          <Sparkles size={16} />
        </span>
        <div className="leading-tight">
          <h1 className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-200 bg-clip-text text-sm font-bold tracking-tight text-transparent">
            GeoLead Finder AI
          </h1>
          <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-slate-500">
            Internal Audit Tool
          </p>
        </div>
      </div>

      {/* System status pill */}
      <span
        className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider sm:inline-flex ${
          settingsOk
            ? "border-accent/40 bg-accent/10 text-emerald-300"
            : "border-amber-500/50 bg-amber-500/10 text-amber-300"
        }`}
        title={settingsOk ? "LLM endpoint linked" : "Configure a key in Settings"}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            settingsOk
              ? "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)]"
              : "bg-amber-400"
          }`}
        />
        {settingsOk ? "System online" : "No key"}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <StatChip label="Analyzed" value={stats.totalAnalyzed} tone="slate" />
        <StatChip label="Targets" value={stats.highPriority} tone="red" />
        <StatChip label="Qualified" value={stats.qualifiedLeads} tone="emerald" />
        <button
          onClick={onOpenSettings}
          title="Settings"
          className={`rounded-lg border p-2 transition-all hover:shadow-glow-sm ${
            settingsOk
              ? "border-surface-border text-slate-400 hover:text-accent"
              : "border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
          }`}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}