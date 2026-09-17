/** AI Opportunity Audit drawer. */

import { Copy, ExternalLink, FileText, Gauge, Globe, MessageSquare, RefreshCw, Target, X } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AiAudit, Lead } from "./types";
import { VENUE_TYPE_LABELS } from "./types";
import { priorityBadgeClass } from "./stats";
import { Button, Spinner } from "./ui";

type OutreachChannel = "sms" | "whatsapp" | "email";

/**
 * // FIX (PROBLÈME 3) : bloc « en cours de génération ». Le tiroir n'attend plus
 * la fin des 4 appels IA : chaque section apparaît dès que son contenu arrive.
 */
function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-surface-border bg-surface-overlay/40 px-4 py-3">
      <div className="space-y-2">
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-slate-700/60" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-slate-700/40" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-700/30" />
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    </div>
  );
}

interface Props {
  lead: Lead | null;
  onClose: () => void;
  onRunAudit: (lead: Lead) => void;
  onRegenerateOutreach: (lead: Lead, channel: OutreachChannel) => void;
  onMarkContacted: (lead: Lead) => void;
  auditing: boolean;
  error: string | null;
}

export function AuditDrawer({
  lead,
  onClose,
  onRunAudit,
  onRegenerateOutreach,
  onMarkContacted,
  auditing,
  error,
}: Props) {
  const [channel, setChannel] = useState<OutreachChannel>("whatsapp");
  const [copied, setCopied] = useState<string | null>(null);

  if (!lead) return null;

  const audit: AiAudit | undefined = lead.audit;
  const copy = (text: string, tag: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-surface-border bg-surface-raised shadow-2xl">
        {/* Header */}
        <header className="border-b border-surface-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 shrink-0 rounded-full ${
                    lead.enrichment.priority === "high"
                      ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]"
                      : lead.enrichment.priority === "medium"
                        ? "bg-amber-400"
                        : "bg-emerald-500"
                  }`}
                />
                <h2 className="truncate text-base font-semibold text-slate-100">{lead.venue.name}</h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {VENUE_TYPE_LABELS[lead.venue.venueType]} · {lead.venue.address}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:bg-slate-700/40 hover:text-slate-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded border px-1.5 py-0.5 font-semibold uppercase ${priorityBadgeClass(lead.enrichment.priority)}`}>
              Score {lead.enrichment.digitalScore}/100 · {lead.enrichment.priority}
            </span>
            {lead.audit?.website ? (
              <a
                href={lead.audit.website.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium transition-colors ${
                  lead.audit.website.verified
                    ? "border-accent/50 bg-accent/10 text-emerald-300 hover:bg-accent/20"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                }`}
                title={lead.audit.website.verified ? "Site officiel vérifié accessible" : "Site proposé par l'IA, non vérifié — à confirmer avant de contacter"}
              >
                <Globe size={11} />
                {lead.audit.website.verified ? "Site web ✓" : "Site web ~"}
                <ExternalLink size={10} className="opacity-70" />
              </a>
            ) : (
              <span className="rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-slate-400">
                {lead.enrichment.checks.hasWebsite ? "Website ✓" : "No website"}
              </span>
            )}
            <span className="rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-slate-400">
              {lead.enrichment.checks.hasSocial ? "Socials ✓" : "No socials"}
            </span>
            <span className="rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-slate-400">
              {lead.venue.openHoursRecorded ? "Hours online ✓" : "Hours hidden"}
            </span>
            <span className="rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-slate-400">
              {lead.venue.id}
            </span>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          ) : null}

          {/* 0. Site quality check (when the venue already has a website) */}
          {lead.siteAudit ? (
            <section className="mb-6">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Gauge size={13} className="text-sky-400" /> Website Quality — Site Check
              </h3>
              <div className="rounded-lg border border-surface-border bg-surface-overlay/60 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                      lead.siteAudit.verdict === "good"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : lead.siteAudit.verdict === "improve"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : "border-red-500/30 bg-red-500/10 text-red-400"
                    }`}
                  >
                    {lead.siteAudit.verdict === "good"
                      ? "Good site"
                      : lead.siteAudit.verdict === "improve"
                        ? "To improve"
                        : "Critical"}
                  </span>
                  <a
                    href={lead.siteAudit.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-sky-300 hover:underline"
                  >
                    {lead.siteAudit.url} <ExternalLink size={10} />
                  </a>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-300">
                  {lead.siteAudit.summary}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-500">
                  <span className="rounded border border-surface-border px-1.5 py-0.5">
                    {lead.siteAudit.checks.https ? "HTTPS ✓" : "HTTPS ✗"}
                  </span>
                  <span className="rounded border border-surface-border px-1.5 py-0.5">
                    {lead.siteAudit.checks.loadMs != null
                      ? `${(lead.siteAudit.checks.loadMs / 1000).toFixed(1)}s`
                      : "speed n/a"}
                  </span>
                  <span className="rounded border border-surface-border px-1.5 py-0.5">
                    {lead.siteAudit.checks.contentReliable
                      ? `${lead.siteAudit.checks.contentChars.toLocaleString()} chars read`
                      : "content not readable"}
                  </span>
                  <span className="rounded border border-surface-border px-1.5 py-0.5">
                    {lead.siteAudit.checks.hasContact ? "contact ✓" : "no contact info"}
                  </span>
                </div>
                {lead.siteAudit.improvements.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {lead.siteAudit.improvements.map((imp, i) => (
                      <li key={i} className="flex gap-2 text-[13px] text-slate-300">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-400" />
                        {imp}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-3 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                  Checked {new Date(lead.siteAudit.generatedAt).toLocaleString()} · {lead.siteAudit.model}
                </p>
              </div>
            </section>
          ) : null}

          {!audit && !auditing ? (
            <div className="rounded-lg border border-dashed border-surface-border bg-surface-overlay/50 p-6 text-center">
              <FileText size={26} className="mx-auto mb-2 text-slate-600" />
              <p className="text-sm text-slate-300">No AI audit yet for this venue.</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
                The agent will analyze the digital gap, draft a cold-outreach message and
                propose 3 sellable services.
              </p>
              <Button variant="primary" className="mt-4" onClick={() => onRunAudit(lead)}>
                <Target size={14} /> Run AI Deep Audit
              </Button>
            </div>
          ) : null}

          {/* FIX (PROBLÈME 3) : spinner seulement tant qu'AUCUN bloc n'est prêt —
              ensuite les sections s'affichent progressivement (streaming). */}
          {auditing && !audit ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Spinner size={28} />
              <p className="text-sm text-slate-400">
                L'agent IA analyse <span className="text-slate-200">{lead.venue.name}</span>…
              </p>
              <p className="text-[11px] text-slate-600">
                4 appels IA en parallèle : rapport d'écart, message de contact, plan d'action,
                recherche du site officiel.
              </p>
            </div>
          ) : null}

          {audit ? (
            <div className="space-y-6">
              {/* FIX (PROBLÈME 1) : les échecs partiels sont AFFICHÉS, plus jamais silencieux. */}
              {audit.warnings && audit.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <p className="font-semibold">Certains blocs n'ont pas pu être générés :</p>
                  <ul className="mt-1 list-disc pl-4">
                    {audit.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* 1. Gap report */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <Target size={13} className="text-accent" /> Digital Gap Report
                  </h3>
                  {audit.gapReport ? (
                    <button
                      onClick={() => copy(audit.gapReport, "gap")}
                      className="text-[11px] text-slate-500 hover:text-accent"
                    >
                      {copied === "gap" ? "Copié !" : <Copy size={12} />}
                    </button>
                  ) : null}
                </div>
                {audit.gapReport ? (
                  <div className="md-body rounded-lg border border-surface-border bg-surface-overlay/60 px-4 py-3">
                    <ReactMarkdown>{audit.gapReport}</ReactMarkdown>
                    {/* curseur de streaming visible pendant la génération */}
                    {auditing ? (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
                    ) : null}
                  </div>
                ) : (
                  <SectionSkeleton
                    label={auditing ? "Rédaction du rapport d'écart…" : "Non généré — relancez l'audit."}
                  />
                )}
              </section>

              {/* 2. Outreach */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <MessageSquare size={13} className="text-accent" /> Cold Outreach Draft
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {(["sms", "whatsapp", "email"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setChannel(c);
                          onRegenerateOutreach(lead, c);
                        }}
                        className={`rounded px-2 py-0.5 text-[11px] uppercase transition-colors ${
                          channel === c
                            ? "bg-accent/20 text-emerald-300"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                    <button
                      onClick={() => copy(audit.outreach, "outreach")}
                      className="ml-1 text-[11px] text-slate-500 hover:text-accent"
                      title="Copy message"
                    >
                      {copied === "outreach" ? "Copied!" : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                {audit.outreach ? (
                  <div className="whitespace-pre-wrap rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
                    {audit.outreach}
                    {auditing ? (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle" />
                    ) : null}
                  </div>
                ) : (
                  <SectionSkeleton
                    label={
                      auditing
                        ? "Rédaction du message de contact…"
                        : "Non généré (erreur IA) — relancez l'audit."
                    }
                  />
                )}
                <button
                  onClick={() => onRegenerateOutreach(lead, channel)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-accent"
                >
                  <RefreshCw size={11} /> Régénérer en {channel}
                </button>
              </section>

              {/* 3. Action plan */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <FileText size={13} className="text-accent" /> Action Plan — 3 Sellable Services
                  </h3>
                  <button
                    onClick={() => copy(audit.actionPlan.join("\n"), "plan")}
                    className="text-[11px] text-slate-500 hover:text-accent"
                  >
                    {copied === "plan" ? "Copied!" : <Copy size={12} />}
                  </button>
                </div>
                {audit.actionPlan.length > 0 ? (
                  <ol className="space-y-2">
                    {audit.actionPlan.map((item, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-surface-border bg-surface-overlay/60 px-4 py-2.5 text-[13px] text-slate-200"
                      >
                        <span className="mr-2 font-bold text-accent">{i + 1}.</span>
                        {item}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <SectionSkeleton
                    label={
                      auditing
                        ? "Construction du plan d'action…"
                        : "Non généré (erreur IA) — relancez l'audit."
                    }
                  />
                )}
              </section>

              <p className="text-[10px] text-slate-600">
                Generated {new Date(audit.generatedAt).toLocaleString()} with {audit.model}.
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-surface-border px-5 py-3">
          <span className="text-[11px] text-slate-500">
            {lead.venue.phone
              ? `Contact: ${lead.venue.phone}`
              : "No phone on record — find it via the website or Google listing"}
          </span>
          <div className="flex gap-2">
            {audit ? (
              <Button onClick={() => onRunAudit(lead)} disabled={auditing}>
                <RefreshCw size={13} /> Re-run audit
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={() => onMarkContacted(lead)}
              disabled={lead.status === "contacted"}
            >
              {lead.status === "contacted" ? "Marked contacted ✓" : "Mark as contacted"}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
