/** CSV / JSON export for filtered leads. */

import type { Lead } from "./types";
import { VENUE_TYPE_LABELS } from "./types";

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_HEADERS = [
  "Name",
  "Category",
  "Latitude",
  "Longitude",
  "Address",
  "Phone",
  "Website",
  "Site Verdict",
  "Digital Score",
  "Priority",
  "Google Rating",
  "Review Count",
  "Status",
  "OSM Id",
];

export function leadsToCsv(leads: Lead[]): string {
  const rows = leads.map((l) =>
    [
      l.venue.name,
      VENUE_TYPE_LABELS[l.venue.venueType],
      l.venue.lat.toFixed(6),
      l.venue.lon.toFixed(6),
      l.venue.address,
      l.venue.phone ?? "",
      l.venue.website ?? "",
      l.siteAudit ? l.siteAudit.verdict : "",
      String(l.enrichment.digitalScore),
      l.enrichment.priority,
      l.enrichment.checks.rating?.toFixed(1) ?? "",
      l.enrichment.checks.reviewCount?.toString() ?? "",
      l.status,
      l.venue.id,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportLeads(leads: Lead[], format: "csv" | "json"): void {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    downloadFile(
      `\uFEFF${leadsToCsv(leads)}`, // BOM so Excel opens UTF-8 correctly
      `geolead-leads-${stamp}.csv`,
      "text/csv;charset=utf-8",
    );
  } else {
    downloadFile(
      JSON.stringify(leads, null, 2),
      `geolead-leads-${stamp}.json`,
      "application/json",
    );
  }
}
