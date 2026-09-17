/** Analytical lead table. */

import { AlertTriangle, Facebook, Gauge, Globe, Phone, SearchCheck } from "lucide-react";
import type { Lead } from "./types";
import { LEAD_STATUS_LABELS, VENUE_TYPE_LABELS } from "./types";
import { priorityBadgeClass } from "./stats";

function WebsiteStatus({ lead }: { lead: Lead }) {
  const { hasWebsite } = lead.enrichment.checks;
  const site = lead.venue.website;
  // 1. OSM-recorded website — the authoritative source, always shown first
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
        <Globe size={12} /> Site web
      </a>
    );
  }
  // 2. Site repéré lors de l'analyse — vérifié (vert) ou à confirmer (ambre)
  if (lead.audit?.website) {
    const found = lead.audit.website;
    return (
      <a
        href={found.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 font-medium hover:underline ${
          found.verified ? "text-emerald-400" : "text-amber-300"
        }`}
        title={`${found.url} — ${
          found.verified
            ? "site officiel trouvé et vérifié (accessible)"
            : "site proposé, non vérifié — à confirmer avant de contacter"
        }`}
      >
        <Globe size={12} /> {found.verified ? "Site vérifié" : "Site à confirmer"}
      </a>
    );
  }
  if (site) {
    return (
      <span
        className="inline-flex items-center gap-1 text-slate-500"
        title={`${site} (page de réseau social uniquement)`}
      >
        <Facebook size={12} /> Réseau social
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-400" title="Aucun site enregistré">
      <AlertTriangle size={12} /> Aucun
    </span>
  );
}

/** Small colored verdict badge shown under a website link. */
function SiteVerdictBadge({ lead }: { lead: Lead }) {
  const sa = lead.siteAudit;
  if (!sa) return null;
  const spec = {
    good: { cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", label: "Bon site" },
    improve: { cls: "text-amber-400 border-amber-500/30 bg-amber-500/10", label: "À améliorer" },
    critical: { cls: "text-red-400 border-red-500/30 bg-red-500/10", label: "Critique" },
  }[sa.verdict];
  return (
    <span
      className={`mt-0.5 inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${spec.cls}`}
      title={`${sa.summary} — contrôlé le ${new Date(sa.generatedAt).toLocaleString()}`}
    >
      <Gauge size={9} /> {spec.label}
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
  onSiteCheck,
  auditingId,
  siteCheckingId,
}: {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
  onAudit: (lead: Lead) => void;
  onSiteCheck: (lead: Lead) => void;
  auditingId: string | null;
  siteCheckingId: string | null;
}) {
  if (leads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500">
        <SearchCheck size={28} className="text-slate-700" />
        Aucun commerce ne correspond aux filtres actuels.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-black/60 font-mono text-[10px] uppercase tracking-[0.15em] backdrop-blur-xl">
          <tr>
            <th className="text-chrome w-8 px-2 py-2 text-right font-semibold">#</th>
            <th className="text-chrome px-2 py-2 font-semibold xl:px-3">Nom</th>
            <th className="text-chrome hidden px-3 py-2 font-semibold md:table-cell">Catégorie</th>
            <th className="text-chrome hidden px-3 py-2 font-semibold lg:table-cell">Téléphone</th>
            <th className="text-chrome hidden px-3 py-2 font-semibold lg:table-cell">Avis</th>
            <th className="text-chrome px-2 py-2 font-semibold xl:px-3">Site web</th>
            <th className="text-chrome px-2 py-2 font-semibold xl:px-3">Score</th>
            <th className="text-chrome hidden px-3 py-2 font-semibold lg:table-cell">Statut</th>
            <th className="text-chrome px-2 py-2 text-right font-semibold xl:px-3">Actions</th>
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
                className={`cursor-pointer border-b border-white/10 transition-colors ${
                  isSelected ? "bg-accent/5" : "hover:bg-slate-800/40"
                }`}
              >
                <td className={`border-l-2 px-2 py-2 text-right font-mono text-[10px] text-slate-600 ${ROW_ACCENT[priority]}`}>
                  {i + 1}
                </td>
                <td className="max-w-[140px] px-2 py-2 sm:max-w-[200px] xl:px-3">
                  <div className="truncate font-medium text-slate-100">{lead.venue.name}</div>
                  <div className="truncate font-mono text-[10px] text-slate-500">
                    {lead.venue.address}
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-slate-400 md:table-cell">
                  {VENUE_TYPE_LABELS[lead.venue.venueType]}
                </td>
                <td className="hidden px-3 py-2 lg:table-cell">
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
                <td className="hidden px-3 py-2 font-mono text-[11px] text-slate-400 lg:table-cell">
                  {checks.rating != null ? (
                    <span>
                      ★ {checks.rating.toFixed(1)} · {checks.reviewCount ?? "?"}
                    </span>
                  ) : checks.reviewCount != null ? (
                    <span>~{checks.reviewCount}+</span>
                  ) : (
                    <span className="text-slate-600">inconnu</span>
                  )}
                </td>
                <td className="px-2 py-2 xl:px-3">
                  <WebsiteStatus lead={lead} />
                  <SiteVerdictBadge lead={lead} />
                </td>
                <td className="px-2 py-2 xl:px-3">
                  <div className="flex items-center gap-2">
                    <div className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-700 sm:block sm:w-14">
                      {/* Barre de score : bordeaux (prioritaire), laiton (moyen),
                          accent bleu/blanc animé (présence correcte). */}
                      <div
                        className={`h-full rounded-full ${
                          priority === "high"
                            ? "bg-red-500 shadow-[0_0_10px_rgba(168,40,63,0.85)]"
                            : priority === "medium"
                              ? "bg-amber-400"
                              : "accent-live"
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
                <td className="hidden px-3 py-2 lg:table-cell">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wide ${
                      lead.status === "contacted"
                        ? "text-emerald-400"
                        : lead.status === "analyzed"
                          ? "text-sky-400"
                          : "text-slate-500"
                    }`}
                  >
                    {LEAD_STATUS_LABELS[lead.status]}
                  </span>
                </td>
                <td className="px-2 py-2 text-right xl:px-3">
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {lead.enrichment.checks.hasWebsite && lead.venue.website ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(lead);
                          onSiteCheck(lead);
                        }}
                        disabled={siteCheckingId === lead.id || auditingId === lead.id}
                        className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-sky-300 transition-all hover:bg-sky-500/20 disabled:opacity-50"
                        title="Contrôler la qualité de ce site (vitesse, HTTPS, contenu)"
                      >
                        {siteCheckingId === lead.id ? (
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-800 border-t-sky-300" />
                        ) : (
                          <Gauge size={10} />
                        )}
                        Site
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(lead);
                        onAudit(lead);
                      }}
                      disabled={auditingId === lead.id}
                      className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-300 transition-colors hover:bg-accent/20 disabled:opacity-50"
                      title="Analyser la fiche de ce commerce"
                    >
                      {auditingId === lead.id ? (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-700 border-t-emerald-300" />
                      ) : null}
                      Analyser
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}