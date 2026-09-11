/** Aggregated statistics and priority color helpers. */

import type { Lead, PriorityTier } from "./types";

export interface Stats {
  totalAnalyzed: number;
  highPriority: number;
  qualifiedLeads: number;
}

export function computeStats(leads: Lead[]): Stats {
  return {
    totalAnalyzed: leads.length,
    highPriority: leads.filter((l) => l.enrichment.priority === "high").length,
    qualifiedLeads: leads.filter(
      (l) => l.status === "contacted" || (l.audit != null && l.enrichment.priority === "high"),
    ).length,
  };
}

export function priorityBadgeClass(priority: PriorityTier): string {
  switch (priority) {
    case "high":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "medium":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "low":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
}
