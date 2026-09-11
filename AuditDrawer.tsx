/** AI Opportunity Audit drawer. */

import { Copy, ExternalLink, FileText, Globe, MessageSquare, RefreshCw, Target, X } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AiAudit, Lead } from "./types";
import { VENUE_TYPE_LABELS } from "./types";
import { priorityBadgeClass } from "./stats";
import { Button, Spinner } from "./ui";

type OutreachChannel = "sms" | "whatsapp" | "email";

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
                    : "border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                }`}
                title={lead.audit.website.verified ? "Site vérifié accessible" : "Site proposé par l'IA (non vérifié)"}
              >
                <Globe size={11} />
                {lead.audit.website.verified ? "Site web ✓" : "Site web ?"}
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

          {auditing ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Spinner size={28} />
              <p className="text-sm text-slate-400">
                AI agent auditing <span className="text-slate-200">{lead.venue.name}</span>…
              </p>
              <p className="text-[11px] text-slate-600">
                Gap report → outreach draft → action plan (3 parallel LLM calls)
              </p>
            </div>
          ) : null}

          {audit ? (
            <div className="space-y-6">
              {/* 1. Gap report */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <Target size={13} className="text-accent" /> Digital Gap Report
                  </h3>
                  <button
                    onClick={() => copy(audit.gapReport, "gap")}
                    className="text-[11px] text-slate-500 hover:text-accent"
                  >
                    {copied === "gap" ? "Copied!" : <Copy size={12} />}
                  </button>
                </div>
                <div className="md-body rounded-lg border border-surface-border bg-surface-overlay/60 px-4 py-3">
                  <ReactMarkdown>{audit.gapReport}</ReactMarkdown>
                </div>
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
                <div className="whitespace-pre-wrap rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
                  {audit.outreach}
                </div>
                <button
                  onClick={() => onRegenerateOutreach(lead, channel)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-accent"
                >
                  <RefreshCw size={11} /> Regenerate for {channel}
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
