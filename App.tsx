/**
 * GeoLead Finder AI — application shell.
 *
 * Roles: landing (interactive globe) → tool (ranked results, no map) →
 * legal pages (mentions légales, confidentialité, CGU) via a tiny hash router.
 */

import {
  Crosshair,
  Download,
  Loader2,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditDrawer } from "./AuditDrawer";
import { CitySearch } from "./CitySearch";
import { FiltersPanel } from "./FiltersPanel";
import { Landing } from "./Landing";
import { LegalPageView } from "./LegalPages";
import { LeadsTable } from "./LeadsTable";
import { SettingsModal } from "./SettingsModal";
import { TopBar } from "./TopBar";
import { Button } from "./ui";
import { AIAgentService, AiAgentError } from "./aiAgent";
import { computeEnrichment } from "./enrichment";
import { exportLeads } from "./export";
import { lookupPlace } from "./places";
import { navigateTo, useRouter } from "./router";
import {
  loadEntered,
  loadAiSettings,
  loadLeads,
  loadPlacesSettings,
  loadScanSummary,
  loadScans,
  saveEntered,
  saveAiSettings,
  saveLeads,
  savePlacesSettings,
  saveScanSummary,
  saveScans,
} from "./storage";
import { computeStats } from "./stats";
import type {
  AiSettings,
  DigitalFilters,
  Lead,
  ScanMeta,
  VenueTypeFilter,
} from "./types";
import type { ScanSummaryData } from "./storage";
import { queryVenues } from "./overpass";
import type { GeoPlace } from "./nominatim";
import type { PlacesSettings } from "./places";

const ALL_TYPES: VenueTypeFilter = {
  restaurant: true,
  fast_food: true,
  cafe: true,
  bakery: true,
  bar: true,
  pub: true,
};

const DEFAULT_DIGITAL: DigitalFilters = {
  noWebsiteOnly: false,
  maxReviews: null,
  highPriorityOnly: false,
};

export default function App() {
  // ---- routing ----
  const route = useRouter();
  const [entered, setEntered] = useState<boolean>(() => loadEntered());
  useEffect(() => saveEntered(entered), [entered]);

  // ---- persisted state ----
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [placesSettings, setPlacesSettings] = useState<PlacesSettings>(() =>
    loadPlacesSettings(),
  );
  const [leads, setLeads] = useState<Lead[]>(() => loadLeads());
  const [scans, setScans] = useState<ScanMeta[]>(() => loadScans());

  // ---- ephemeral state ----
  const [cityQuery, setCityQuery] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<GeoPlace | null>(null);
  const [venueTypes, setVenueTypes] = useState<VenueTypeFilter>(ALL_TYPES);
  const [digital, setDigital] = useState<DigitalFilters>(DEFAULT_DIGITAL);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [auditingId, setAuditingId] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  /** Summary shown in the results header after a scan (persisted). */
  const [scanSummary, setScanSummary] = useState<ScanSummaryData | null>(() =>
    loadScanSummary(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => saveScanSummary(scanSummary), [scanSummary]);
  useEffect(() => saveAiSettings(aiSettings), [aiSettings]);
  useEffect(() => savePlacesSettings(placesSettings), [placesSettings]);
  useEffect(() => saveLeads(leads), [leads]);
  useEffect(() => saveScans(scans), [scans]);

  // ---- derived ----
  const stats = useMemo(() => computeStats(leads), [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (!venueTypes[l.venue.venueType]) return false;
      if (digital.highPriorityOnly && l.enrichment.priority !== "high") return false;
      if (digital.noWebsiteOnly && l.enrichment.checks.hasWebsite) return false;
      if (
        digital.maxReviews != null &&
        l.enrichment.checks.reviewCount != null &&
        l.enrichment.checks.reviewCount > digital.maxReviews
      ) {
        return false;
      }
      return true;
    });
  }, [leads, venueTypes, digital]);

  const drawerLead = useMemo(
    () => leads.find((l) => l.id === drawerLeadId) ?? null,
    [leads, drawerLeadId],
  );

  const sortedLeads = useMemo(
    () =>
      [...filteredLeads].sort((a, b) => {
        const tier = { high: 0, medium: 1, low: 2 } as const;
        if (tier[a.enrichment.priority] !== tier[b.enrichment.priority]) {
          return tier[a.enrichment.priority] - tier[b.enrichment.priority];
        }
        return a.enrichment.digitalScore - b.enrichment.digitalScore;
      }),
    [filteredLeads],
  );

  // ---- scan flow ----
  const analyzeArea = useCallback(async () => {
    if (!selectedPlace) return;
    setScanning(true);
    setScanError(null);
    setStatusMsg("Querying OpenStreetMap overpass…");
    try {
      const { venues: allVenues } = await queryVenues(selectedPlace);

      // Don't dump the whole metropolitan area: cap the scan so results stay
      // targeted. Refining the query (e.g. "Lyon 4e") narrows the area.
      const SCAN_CAP = 700;
      const venues = allVenues.slice(0, SCAN_CAP);
      const capped = allVenues.length > SCAN_CAP;

      setStatusMsg(
        placesSettings.enabled && placesSettings.apiKey
          ? `Enriching ${venues.length} venues via Google Places…`
          : `Scoring ${venues.length} venues…`,
      );

      const usePlaces = placesSettings.enabled && Boolean(placesSettings.apiKey);
      const enriched: Lead[] = [];
      const batchSize = 8;
      for (let i = 0; i < venues.length; i += batchSize) {
        const batch = venues.slice(i, i + batchSize);
        const batchLeads = await Promise.all(
          batch.map(async (venue): Promise<Lead> => {
            const enrichment = computeEnrichment(venue);
            if (usePlaces) {
              try {
                const lookup = await lookupPlace(
                  { apiKey: placesSettings.apiKey, enabled: true },
                  venue.name,
                  venue.address,
                );
                if (lookup) {
                  if (lookup.rating != null) enrichment.checks.rating = lookup.rating;
                  if (lookup.reviewCount != null) {
                    enrichment.checks.reviewCount = lookup.reviewCount;
                    enrichment.checks.reviewsKnown = true;
                    if (lookup.reviewCount > 50) {
                      enrichment.digitalScore = Math.min(100, enrichment.digitalScore + 30);
                    }
                  }
                  if (lookup.website && !enrichment.checks.hasWebsite) {
                    venue.website = lookup.website;
                  }
                  if (lookup.businessStatus) {
                    enrichment.signals.push(`Google status: ${lookup.businessStatus}`);
                  }
                  enrichment.checks.source = "google-places";
                  const score = enrichment.digitalScore;
                  enrichment.priority = score < 40 ? "high" : score < 70 ? "medium" : "low";
                }
              } catch {
                enrichment.signals.push("Google Places lookup failed — heuristic score kept");
              }
            }
            return {
              id: venue.id,
              venue,
              enrichment,
              status: "new" as const,
              addedAt: new Date().toISOString(),
            };
          }),
        );
        enriched.push(...batchLeads);
        if (i + batchSize < venues.length) {
          setStatusMsg(`Enriching venues… ${Math.min(i + batchSize, venues.length)}/${venues.length}`);
        }
      }

      // A scan is a fresh targeted search on the chosen area: replace the pool.
      setLeads(enriched);
      setSelectedId(null);
      setDrawerLeadId(null);

      const meta: ScanMeta = {
        city: selectedPlace.shortName,
        displayName: selectedPlace.displayName,
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        radiusKm: 0,
        scannedAt: new Date().toISOString(),
        totalFound: venues.length,
      };
      setScans((prev) => [meta, ...prev.filter((s) => s.displayName !== meta.displayName)].slice(0, 20));

      const high = enriched.filter((l) => l.enrichment.priority === "high").length;
      setScanSummary({
        city: selectedPlace.shortName,
        total: venues.length,
        high,
        capped,
      });
      setStatusMsg(null);
      setShowFilters(false);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
      setStatusMsg(null);
    } finally {
      setScanning(false);
    }
  }, [selectedPlace, placesSettings]);

  // ---- AI audit flow ----
  const runAudit = useCallback(
    async (lead: Lead) => {
      if (!aiSettings.apiKey) {
        setSettingsOpen(true);
        return;
      }
      setDrawerLeadId(lead.id);
      setSelectedId(lead.id);
      setAuditingId(lead.id);
      setAuditError(null);
      try {
        const agent = new AIAgentService(aiSettings);
        const audit = await agent.fullAudit(lead);
        setLeads((prev) =>
          prev.map((l) => {
            if (l.id !== lead.id) return l;
            // Feed the AI-discovered website into the venue so the table shows a direct link
            const venue =
              !l.venue.website && audit.website
                ? { ...l.venue, website: audit.website.url }
                : l.venue;
            return { ...l, audit, venue, status: l.status === "contacted" ? "contacted" : "analyzed" };
          }),
        );
      } catch (err) {
        setAuditError(
          err instanceof AiAgentError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown audit error",
        );
      } finally {
        setAuditingId(null);
      }
    },
    [aiSettings],
  );

  const regenerateOutreach = useCallback(
    async (lead: Lead, channel: "sms" | "whatsapp" | "email") => {
      if (!aiSettings.apiKey || auditingId) return;
      setAuditingId(lead.id);
      setAuditError(null);
      try {
        const agent = new AIAgentService(aiSettings);
        const outreach = await agent.generateOutreach(lead, channel);
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id && l.audit ? { ...l, audit: { ...l.audit, outreach } } : l,
          ),
        );
      } catch (err) {
        setAuditError(err instanceof Error ? err.message : "Outreach generation failed");
      } finally {
        setAuditingId(null);
      }
    },
    [aiSettings, auditingId],
  );

  const markContacted = useCallback((lead: Lead) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, status: "contacted" as const } : l)),
    );
  }, []);

  const focusLead = useCallback((lead: Lead) => {
    setSelectedId(lead.id);
  }, []);

  const openDrawer = useCallback((lead: Lead) => {
    setDrawerLeadId(lead.id);
    setAuditError(null);
  }, []);

  const handleSelectPlace = useCallback((place: GeoPlace) => {
    setSelectedPlace(place);
    setStatusMsg(`${place.shortName} selected — ready to analyze.`);
  }, []);

  // ---- routing render ----
  if (route.role === "legal") {
    return (
      <div className="h-full w-full overflow-y-auto">
        <LegalPageView page={route.page} onBack={() => navigateTo("#/")} />
      </div>
    );
  }

  if (!entered) {
    return (
      <div className="h-full w-full overflow-y-auto">
        <Landing onEnter={() => setEntered(true)} />
      </div>
    );
  }

  // ---- tool ----
  return (
    <div className="bg-grid flex h-full w-full flex-col overflow-hidden">
      <TopBar
        stats={stats}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOk={Boolean(aiSettings.apiKey)}
        onHome={() => setEntered(false)}
      />

      {/* Scan bar */}
      <div className="border-b border-surface-border bg-surface/80 px-4 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <Crosshair size={15} className="shrink-0 text-accent" />
          <CitySearch
            value={cityQuery}
            onChange={setCityQuery}
            onSelect={handleSelectPlace}
            disabled={scanning}
          />
          <Button
            variant="primary"
            onClick={analyzeArea}
            disabled={scanning || !selectedPlace}
            title={selectedPlace ? `Analyze ${selectedPlace.shortName}` : "Pick a city first"}
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
            {scanning ? "Analyzing…" : "Analyze Area"}
          </Button>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors xl:hidden ${
              showFilters
                ? "border-accent/50 bg-accent/10 text-emerald-300"
                : "border-surface-border text-slate-300 hover:border-slate-500"
            }`}
            title="Filters"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>
      </div>

      {statusMsg || scanError ? (
        <div
          className={`flex items-center gap-2 border-b px-4 py-1.5 font-mono text-[11px] ${
            scanError
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-surface-border bg-surface-raised text-slate-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              scanError
                ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                : "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
            }`}
          />
          {scanError ?? statusMsg}
        </div>
      ) : null}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-5">
          {/* Results banner */}
          <div className="rounded-xl border border-surface-border bg-gradient-to-r from-accent/10 via-surface-raised to-surface-raised px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100">
                  <Trophy size={18} className="shrink-0 text-accent" />
                  {scanSummary ? scanSummary.city : "Prospect Results"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {scanSummary ? (
                    <>
                      <span className="font-semibold text-slate-200">{scanSummary.total}</span> businesses
                      scanned · <span className="font-semibold text-red-400">{scanSummary.high} priority targets</span>
                      {scanSummary.capped ? " · scan capped (refine with a district)" : ""} — ranked by weakest
                      digital presence first
                    </>
                  ) : (
                    "Run a scan to see ranked prospects here"
                  )}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  onClick={() => exportLeads(sortedLeads, "csv")}
                  disabled={sortedLeads.length === 0}
                >
                  <Download size={13} /> CSV
                </Button>
                <Button
                  onClick={() => exportLeads(sortedLeads, "json")}
                  disabled={sortedLeads.length === 0}
                >
                  <Download size={13} /> JSON
                </Button>
                {leads.length > 0 ? (
                  <Button
                    variant="danger"
                    title="Clear all scanned leads"
                    onClick={() => {
                      if (!window.confirm("Delete all scanned leads and results?")) return;
                      setLeads([]);
                      setScanSummary(null);
                      setSelectedId(null);
                      setDrawerLeadId(null);
                    }}
                  >
                    <RotateCcw size={13} /> Reset
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Filters + table */}
          <div className="mt-4 flex items-start gap-5">
            {/* Sidebar: sticky on desktop, collapsible on small screens */}
            <aside
              className={`${
                showFilters
                  ? "block w-full shrink-0"
                  : "hidden"
              } w-full xl:block xl:w-[260px] xl:shrink-0`}
            >
              <div className="xl:sticky xl:top-2 rounded-xl border border-surface-border bg-surface-raised/70 px-4 py-3">
                <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Filters
                </h3>
                <FiltersPanel
                  venueTypes={venueTypes}
                  digital={digital}
                  onVenueTypes={setVenueTypes}
                  onDigital={setDigital}
                />
                {scans.length > 0 ? (
                  <p className="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-slate-600">
                    Last scans:
                    <br />
                    {scans
                      .slice(0, 3)
                      .map((s) => `${s.city} (${s.totalFound})`)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            </aside>

            <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-surface-border bg-surface-raised/50">
              <LeadsTable
                leads={sortedLeads}
                selectedId={selectedId}
                onSelect={focusLead}
                onAudit={(lead) => {
                  focusLead(lead);
                  openDrawer(lead);
                  runAudit(lead);
                }}
                auditingId={auditingId}
              />
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-relaxed text-slate-600">
            Data © OpenStreetMap contributors (ODbL) — AI results are indicative and must be
            verified before outreach. Use responsibly:{" "}
            <a href="#/mentions-legales" className="underline decoration-slate-700 hover:text-accent">
              legal notice
            </a>{" "}
            ·{" "}
            <a href="#/confidentialite" className="underline decoration-slate-700 hover:text-accent">
              privacy
            </a>{" "}
            ·{" "}
            <a href="#/cgu" className="underline decoration-slate-700 hover:text-accent">
              terms
            </a>
          </p>
        </div>
      </div>

      <AuditDrawer
        lead={drawerLead}
        onClose={() => setDrawerLeadId(null)}
        onRunAudit={runAudit}
        onRegenerateOutreach={regenerateOutreach}
        onMarkContacted={markContacted}
        auditing={auditingId === drawerLeadId}
        error={auditError}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        aiSettings={aiSettings}
        placesSettings={placesSettings}
        onSaveAi={setAiSettings}
        onSavePlaces={setPlacesSettings}
      />
    </div>
  );
}
