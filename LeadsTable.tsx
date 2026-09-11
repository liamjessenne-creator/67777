/** Analytical lead table. */

import { AlertTriangle, Facebook, Globe, Phone, SearchCheck } from "lucide-react";
import type { Lead } from "./types";
import { VENUE_TYPE_LABELS } from "./types";
import { priorityBadgeClass } from "./stats";

function WebsiteStatus({ lead }: { lead: Lead }) {
  const { hasWebsite } = lead.enrichment.checks;
  const site = lead.venue.website;
  // AI-discovered site (fed back into venue.website after an audit)
  if (site && lead.audit?.website?.url === site) {
    return (
      <a
        href={site}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 font-medium hover:underline ${
          lead.audit.website.verified ? "text-emerald-400" : "text-sky-300"
        }`}
        title={`${site} — ${lead.audit.website.verified ? "trouvé et vérifié par l'IA" : "proposé par l'IA (non vérifié)"}`}
      >
        <Globe size={12} /> {lead.audit.website.verified ? "Site IA ✓" : "Site IA ?"}
      </a>
    );
  }
  if (hasWebsite && site) {
    return (
      <a
        href={site}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
        title={site}
      >
        <Globe size={12} /> Website
      </a>
    );
  }
  if (site) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-500" title={`${site} (social page only)`}>
        <Facebook size={12} /> Social only
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-400" title="No website recorded">
      <AlertTriangle size={12} /> None
    </span>
  );
}

const ROW_ACCENT: Record<string, string> = {
  high: "border-l-red-500/70",
  medium: "border-l-amber-400/60",
  low: "border-l-emerald-500/40",
};

export function LeadsTable({
  leads,
  selectedId,
  onSelect,
  onAudit,
  auditingId,
}: {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  onAudit: (lead: Lead) => void;
  auditingId: string | null;
}) {
  if (leads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500">
        <SearchCheck size={28} className="text-slate-700" />
        No leads match the current filters.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-surface-raised font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">
          <tr>
            <th className="w-8 px-2 py-2 text-right font-semibold text-slate-600">#</th>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Category</th>
            <th className="px-3 py-2 font-semibold">Phone</th>
            <th className="px-3 py-2 font-semibold">Reviews</th>
            <th className="px-3 py-2 font-semibold">Website</th>
            <th className="px-3 py-2 font-semibold">Score</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => {
            const { digitalScore, priority, checks } = lead.enrichment;
            const isSelected = lead.id === selectedId;
            const scoreColor =
              priority === "high"
                ? "text-red-400"
                : priority === "medium"
                  ? "text-amber-400"
                  : "text-emerald-400";
            return (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead)}
                className={`cursor-pointer border-b border-surface-border/60 transition-colors ${
                  isSelected ? "bg-accent/5" : "hover:bg-slate-800/40"
                }`}
              >
                <td className={`border-l-2 px-2 py-2 text-right font-mono text-[10px] text-slate-600 ${ROW_ACCENT[priority]}`}>
                  {i + 1}
                </td>
                <td className="max-w-[200px] px-3 py-2">
                  <div className="truncate font-medium text-slate-100">{lead.venue.name}</div>
                  <div className="truncate font-mono text-[10px] text-slate-500">
                    {lead.venue.address}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {VENUE_TYPE_LABELS[lead.venue.venueType]}
                </td>
                <td className="px-3 py-2">
                  {lead.venue.phone ? (
                    <a
                      href={`tel:${lead.venue.phone.replace(/\s/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300 hover:text-accent"
                    >
                      <Phone size={11} /> {lead.venue.phone}
                    </a>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                  {checks.rating != null ? (
                    <span>
                      ★ {checks.rating.toFixed(1)} · {checks.reviewCount ?? "?"}
                    </span>
                  ) : checks.reviewCount != null ? (
                    <span>~{checks.reviewCount}+</span>
                  ) : (
                    <span className="text-slate-600">unknown</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <WebsiteStatus lead={lead} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-700">
                      <div
                        className={`h-full rounded-full ${
                          priority === "high"
                            ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]"
                            : priority === "medium"
                              ? "bg-amber-400"
                              : "bg-emerald-500"
                        }`}
                        style={{ width: `${digitalScore}%` }}
                      />
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${priorityBadgeClass(priority)} ${scoreColor}`}
                    >
                      {digitalScore}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wide ${
                      lead.status === "contacted"
                        ? "text-emerald-400"
                        : lead.status === "analyzed"
                          ? "text-sky-400"
                          : "text-slate-500"
                    }`}
                  >
                    {lead.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(lead);
                      onAudit(lead);
                    }}
                    disabled={auditingId === lead.id}
                    className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300 transition-all hover:bg-accent/20 hover:shadow-glow-sm disabled:opacity-50"
                  >
                    {auditingId === lead.id ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-700 border-t-emerald-300" />
                    ) : null}
                    Audit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}