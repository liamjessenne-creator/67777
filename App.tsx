/**
 * GeoLead Finder AI — application shell.
 *
 * Roles: landing (interactive globe) → tool (ranked results, no map) →
 * legal pages (mentions légales, confidentialité, CGU) via a tiny hash router.
 */

import {
  Crosshair,
  Database,
  Download,
  Gauge,
  Loader2,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditDrawer } from "./AuditDrawer";
// FIX : fond animé ChromeCells (composant fourni) derrière toute l'interface.
import ChromeCells from "./ChromeCells";
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
// FIX (PROBLÈME 1) : la passerelle Edge remplace la clé côté navigateur.
import { isGatewayConfigured } from "./llmClient";
// FIX (PROBLÈMES 1, 2 & 3) : logs, messages d'erreur FR et parallélisme borné.
import { describeError, logError, logInfo, mapLimit } from "./net";
import {
  loadAiSettings,
  loadLeads,
  loadPlacesSettings,
  loadScanSummary,
  loadScans,
  saveAiSettings,
  saveLeads,
  savePlacesSettings,
  saveScanSummary,
  saveScans,
} from "./storage";
import { computeStats } from "./stats";
import type {
  AiAudit,
  AiSettings,
  DigitalFilters,
  Lead,
  ScanMeta,
  Venue,
  VenueOrigin,
  VenueTypeFilter,
} from "./types";
import type { ScanSummaryData } from "./storage";
import { queryVenues } from "./overpass";
import type { GeoPlace } from "./geocoding";
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
  // The landing page (interactive globe) always shows first on each visit;
  // "Launch the tool" or clicking the globe enters the tool for the session.
  const [entered, setEntered] = useState(false);

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
  /** Batch "site check" over venues that already have a website. */
  const [siteScan, setSiteScan] = useState<{
    active: boolean;
    done: number;
    total: number;
    last: string | null;
  }>({ active: false, done: 0, total: 0, last: null });
  const stopSiteScanRef = useRef(false);
  /** Lead currently undergoing a single-row site check. */
  const [siteCheckingId, setSiteCheckingId] = useState<string | null>(null);
  /**
   * // FIX (PROBLÈME 2 — mobile) : étape courante + chrono affichés en direct
   * (« Recherche des commerces… 3,2 s ») — l'interface reste réactive et
   * l'utilisateur voit toujours où en est le traitement.
   */
  const [scanStep, setScanStep] = useState<string | null>(null);
  const [scanElapsedMs, setScanElapsedMs] = useState(0);
  /** // FIX (PROBLÈME 2) : vrai quand on affiche le dernier scan réussi (cache). */
  const [usingCache, setUsingCache] = useState(false);
  /**
   * // FIX (honnêteté + fiabilité) : vrai quand OpenStreetMap n'a pas répondu et
   * qu'on PEUT proposer des pistes reconstituées par l'analyse. Le repli reste
   * un choix de l'utilisateur : un modèle peut citer des établissements qui
   * n'existent pas, on ne présente donc jamais ces pistes comme des commerces
   * relevés.
   */
  const [aiFallbackOffered, setAiFallbackOffered] = useState(false);
  /** Copie de secours des résultats précédents (repli si le réseau lâche). */
  const leadsRef = useRef<Lead[]>(leads);
  leadsRef.current = leads;

  // // FIX (PROBLÈME 2 & 3) : chronomètre visible pendant l'analyse.
  useEffect(() => {
    if (!scanning) return;
    const startedAt = Date.now();
    setScanElapsedMs(0);
    const id = setInterval(() => setScanElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [scanning]);

  useEffect(() => saveScanSummary(scanSummary), [scanSummary]);
  useEffect(() => saveAiSettings(aiSettings), [aiSettings]);
  useEffect(() => savePlacesSettings(placesSettings), [placesSettings]);
  useEffect(() => saveLeads(leads), [leads]);
  useEffect(() => saveScans(scans), [scans]);

  // ---- derived ----
  const stats = useMemo(() => computeStats(leads), [leads]);

  /**
   * // FIX (remplacement de Groq) : l'analyse est TOUJOURS disponible — la
   * passerelle `/api/llm` est fournie par l'app elle-même (proxy Vite en
   * local, fonction serverless en production).
   */
  const aiConfigured = useMemo(
    () => isGatewayConfigured(aiSettings.proxyUrl),
    [aiSettings.proxyUrl],
  );

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
  // // FIX (mobile & clavier) : la ville peut être passée en argument. Appuyer
  // sur Entrée dans le champ ville lance ainsi l'analyse tout de suite, sans
  // dépendre d'un état React pas encore appliqué (l'ancien bouton restait
  // inactif après un rechargement, alors que des résultats étaient affichés).
  const analyzeArea = useCallback(async (placeArg?: GeoPlace, opts: { allowAi?: boolean } = {}) => {
    const place = placeArg ?? selectedPlace;
    if (!place) return;
    // // FIX (PROBLÈME 2) : on mémorise le dernier scan réussi AVANT de toucher
    // aux résultats → repli « résultats en cache » si le réseau lâche.
    const previousLeads = leadsRef.current;
    const startedAt = Date.now();
    setScanning(true);
    setScanError(null);
    setUsingCache(false);
    setAiFallbackOffered(false);
    setScanStep("Recherche des commerces…");
    try {
      /**
       * // FIX (fiabilité — « Overpass ne marche pas à chaque fois ») : trois
       * tentatives successives, de la plus fidèle à la plus dégradée.
       *   1. miroirs publics interrogés en direct depuis le navigateur ;
       *   2. passerelle serveur `/api/osm` (mise en cache, User-Agent correct) ;
       *   3. sur demande EXPLICITE de l'utilisateur : pistes reconstituées par
       *      le modèle Groq (`origin: "ia"`), signalées comme non vérifiées.
       * L'étape 3 n'est JAMAIS automatique : un modèle peut citer des
       * établissements qui n'existent pas, et une liste de faux prospects est
       * plus dangereuse qu'une erreur claire.
       */
      let allVenues: Venue[] = [];
      let endpointUsed = "";
      let durationMs = 0;
      let scanOrigin: VenueOrigin = "osm";

      try {
        const res = await queryVenues(place, {
          // // FIX (PROBLÈME 2) : l'utilisateur voit QUELS miroirs sont
          // interrogés et combien de temps cela prend — plus d'attente muette.
          onProgress: ({ host, attempt, total, shape }) =>
            setScanStep(
              `Recherche des commerces… (${host} — manche ${attempt}/${total}` +
                `${shape ? `, ${shape}` : ""})`,
            ),
        });
        allVenues = res.venues;
        endpointUsed = res.endpointUsed;
        durationMs = res.durationMs;
        logInfo("scan", `${allVenues.length} commerces via ${endpointUsed} en ${durationMs} ms`, {
          ville: place.displayName,
        });
        // Zone réellement vide (JSON valide, aucun commerce cartographié).
        if (allVenues.length === 0) {
          throw new Error(
            `Aucun commerce cartographié à « ${place.shortName} ». Essayez une zone plus large ou un autre quartier.`,
          );
        }
      } catch (osmError) {
        // Annulation volontaire : on ne bascule pas sur l'analyse.
        if ((osmError as { name?: string })?.name === "AbortError") throw osmError;
        logError("scan", osmError, {
          ville: place.displayName,
          etape: "OpenStreetMap",
          modeleRepli: opts.allowAi ? "accepte" : "propose-a-l-utilisateur",
        });
        if (!opts.allowAi) {
          // On s'arrête là et on PROPOSE le repli : rien n'est inventé sans accord.
          setAiFallbackOffered(aiConfigured);
          throw osmError;
        }
        if (!aiConfigured) {
          throw new Error(
            `${describeError(osmError)} Aucune passerelle d'analyse n'est configurée pour reconstituer des pistes : ouvrez ⚙ Réglages.`,
          );
        }
        const agent = new AIAgentService(aiSettings);
        setScanStep("Serveurs cartographiques injoignables — reconstitution de pistes par l'analyse…");
        allVenues = await agent.discoverVenues(place, (message) => setScanStep(message));
        scanOrigin = "ia";
        endpointUsed = "analyse (serveur IA)";
        durationMs = Date.now() - startedAt;
        logInfo("scan", `${allVenues.length} pistes reconstituées par l'analyse`, {
          ville: place.displayName,
          raisonOsm: describeError(osmError),
        });
      }

      // Don't dump the whole metropolitan area: cap the scan so results stay
      // targeted. Refining the query (e.g. "Lyon 4e") narrows the area.
      const SCAN_CAP = 700;
      const capped = allVenues.length > SCAN_CAP;
      const venues = allVenues.slice(0, SCAN_CAP);
      if (venues.length === 0) {
        throw new Error(
          `Aucun commerce trouvé à « ${place.shortName} ». Essayez une zone plus large ou un autre quartier.`,
        );
      }

      const usePlaces = placesSettings.enabled && Boolean(placesSettings.apiKey);
      setScanStep("Analyse de leur présence internet…");

      // // FIX (PROBLÈME 2 & 3) : affichage PROGRESSIF — les commerces sont
      // ajoutés au fur et à mesure (l'utilisateur n'attend plus la fin pour voir
      // quelque chose), et la concurrence est BORNÉE (6 appels Google max en vol,
      // 16 sans Google) pour ne pas saturer un réseau mobile.
      const enriched: Lead[] = [];
      let completed = 0;
      let placesFailures = 0;

      await mapLimit(venues, usePlaces ? 6 : 16, async (venue) => {
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
                enrichment.signals.push(`Statut Google : ${lookup.businessStatus}`);
              }
              enrichment.checks.source = "google-places";
              const score = enrichment.digitalScore;
              enrichment.priority = score < 40 ? "high" : score < 70 ? "medium" : "low";
            }
          } catch (err) {
            // // FIX (PROBLÈME 1) : plus d'échec silencieux — compteur + log exact.
            placesFailures += 1;
            logError("scan", err, { etape: "Google Places", commerce: venue.name });
            enrichment.signals.push("Fiche Google indisponible — score heuristique conservé");
          }
        }
        enriched.push({
          id: venue.id,
          venue,
          enrichment,
          status: "new" as const,
          addedAt: new Date().toISOString(),
        });
        completed += 1;
        if (completed % 10 === 0 || completed === venues.length) {
          // Affichage progressif : la table se remplit pendant l'analyse.
          setLeads([...enriched]);
          setScanStep(`Analyse de leur présence internet… ${completed}/${venues.length}`);
        }
      });

      // A scan is a fresh targeted search on the chosen area: replace the pool.
      setLeads(enriched);
      setSelectedId(null);
      setDrawerLeadId(null);

      if (placesFailures > 0) {
        logInfo("scan", `${placesFailures} fiches Google indisponibles sur ${venues.length}`);
      }

      const meta: ScanMeta = {
        city: place.shortName,
        displayName: place.displayName,
        lat: place.lat,
        lon: place.lon,
        radiusKm: 0,
        scannedAt: new Date().toISOString(),
        totalFound: venues.length,
      };
      setScans((prev) => [meta, ...prev.filter((s) => s.displayName !== meta.displayName)].slice(0, 20));

      const high = enriched.filter((l) => l.enrichment.priority === "high").length;
      const totalMs = Date.now() - startedAt;
      // // FIX (PROBLÈME 2) : le résumé (avec date + durée) sert aussi de cache.
      setScanSummary({
        city: place.shortName,
        total: venues.length,
        high,
        capped,
        scannedAt: new Date().toISOString(),
        durationMs: totalMs,
        origin: scanOrigin,
      });
      logInfo("scan", `analyse terminée en ${totalMs} ms`, {
        commerces: venues.length,
        cibles: high,
      });
      setScanStep(null);
      setShowFilters(false);
    } catch (err) {
      // // FIX (PROBLÈME 1) : message clair en français + erreur exacte en console.
      const message = describeError(err);
      logError("scan", err, { ville: place.displayName });
      setScanError(message);
      setScanStep(null);
      // // FIX (PROBLÈME 2) : repli automatique sur le cache local (dernier scan
      // réussi) au lieu de laisser un écran vide sans explication.
      if (previousLeads.length > 0) {
        setLeads(previousLeads);
        setUsingCache(true);
        logInfo("scan", `repli sur le cache : ${previousLeads.length} résultats précédents`);
      }
    } finally {
      setScanning(false);
    }
  }, [selectedPlace, placesSettings, aiConfigured, aiSettings]);

  // ---- AI audit flow ----
  const runAudit = useCallback(
    async (lead: Lead) => {
      if (!aiConfigured) {
        setSettingsOpen(true);
        return;
      }
      setDrawerLeadId(lead.id);
      setSelectedId(lead.id);
      setAuditingId(lead.id);
      setAuditError(null);
      const startedAt = Date.now();
      // // FIX (PROBLÈME 3) : squelette d'audit publié immédiatement, puis rempli
      // bloc par bloc (le tiroir affiche le rapport pendant sa génération).
      const placeholder: AiAudit = {
        gapReport: "",
        outreach: "",
        actionPlan: [],
        website: null,
        generatedAt: new Date().toISOString(),
        model: aiSettings.model,
      };
      try {
        const agent = new AIAgentService(aiSettings);
        const audit = await agent.fullAudit(lead, {
          onPartial: (partial) => {
            setLeads((prev) =>
              prev.map((l) => {
                if (l.id !== lead.id) return l;
                const base = l.audit ?? placeholder;
                return {
                  ...l,
                  audit: {
                    ...base,
                    gapReport: partial.gapReport ?? base.gapReport,
                    outreach: partial.outreach ?? base.outreach,
                    actionPlan: partial.actionPlan ?? base.actionPlan,
                    website: partial.website !== undefined ? partial.website : base.website,
                    warnings: partial.warnings ?? base.warnings,
                    generatedAt: new Date().toISOString(),
                    model: aiSettings.model,
                  },
                };
              }),
            );
          },
        });
        logInfo("audit", `${lead.venue.name} analysé en ${Date.now() - startedAt} ms`);
        setLeads((prev) =>
          prev.map((l) => {
            if (l.id !== lead.id) return l;
            // Feed the AI-discovered website into the venue so the table shows a
            // direct link — but ONLY when it was verified reachable, and never
            // over an existing website record.
            const venue =
              !l.venue.website && audit.website?.verified
                ? { ...l.venue, website: audit.website.url }
                : l.venue;
            return { ...l, audit, venue, status: l.status === "contacted" ? "contacted" : "analyzed" };
          }),
        );
      } catch (err) {
        // // FIX (PROBLÈME 1) : erreur IA toujours affichée en français + loggée.
        logError("audit", err, { commerce: lead.venue.name });
        setAuditError(
          err instanceof AiAgentError
            ? err.message
            : `L'analyse a échoué : ${describeError(err)}. Relancez l'analyse.`,
        );
      } finally {
        setAuditingId(null);
      }
    },
    [aiSettings],
  );

  const regenerateOutreach = useCallback(
    async (lead: Lead, channel: "sms" | "whatsapp" | "email") => {
      if (!aiConfigured || auditingId) return;
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
        // // FIX (PROBLÈME 1) : message clair en français + erreur exacte en console.
        logError("audit", err, { etape: "message de contact", commerce: lead.venue.name });
        setAuditError(`Génération du message impossible : ${describeError(err)}`);
      } finally {
        setAuditingId(null);
      }
    },
    [aiSettings, aiConfigured, auditingId],
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

  /**
   * Batch "site check": for every venue that ALREADY has a website, run
   * browser-side technical checks + the SiteScanBot AI verdict. Sequential,
   * stoppable, and each result is persisted as it lands.
   */
  const runSiteChecks = useCallback(async () => {
    if (!aiConfigured || siteScan.active) return;
    const targets = leads.filter((l) => l.enrichment.checks.hasWebsite && l.venue.website);
    if (targets.length === 0) {
      setStatusMsg("Aucun commerce avec un site web dans les résultats actuels.");
      return;
    }
    stopSiteScanRef.current = false;
    setSiteScan({ active: true, done: 0, total: targets.length, last: null });
    // // FIX (PROBLÈME 3) : 4 sites vérifiés EN PARALLÈLE (avant : un par un →
    // plusieurs minutes pour 30 sites). Chaque résultat est persisté dès qu'il tombe.
    setStatusMsg(`Vérification de ${targets.length} sites (4 en parallèle)…`);
    const startedAt = Date.now();

    const agent = new AIAgentService(aiSettings);
    let done = 0;
    await mapLimit(targets, 4, async (lead) => {
      if (stopSiteScanRef.current) return;
      try {
        const audit = await agent.auditWebsiteQuality(lead);
        if (audit) {
          setLeads((prev) =>
            prev.map((l) => (l.id === lead.id ? { ...l, siteAudit: audit } : l)),
          );
        }
      } catch (err) {
        // // FIX (PROBLÈME 1) : un site en échec n'interrompt plus le lot — log + continue.
        logError("siteCheck", err, { commerce: lead.venue.name, site: lead.venue.website });
      } finally {
        done += 1;
        setSiteScan({
          active: done < targets.length && !stopSiteScanRef.current,
          done,
          total: targets.length,
          last: lead.venue.name,
        });
      }
    });
    logInfo("siteCheck", `${done}/${targets.length} sites vérifiés en ${Date.now() - startedAt} ms`);
    setStatusMsg(null);
  }, [aiSettings, aiConfigured, leads, siteScan.active]);

  const stopSiteChecks = useCallback(() => {
    stopSiteScanRef.current = true;
    setSiteScan((s) => ({ ...s, active: false }));
  }, []);

  /** Site check on a single row (per-row "SITE" button). */
  const runSiteCheckOne = useCallback(
    async (lead: Lead) => {
      if (!aiConfigured || siteCheckingId) return;
      setSiteCheckingId(lead.id);
      try {
        const agent = new AIAgentService(aiSettings);
        const audit = await agent.auditWebsiteQuality(lead);
        if (audit) {
          setLeads((prev) =>
            prev.map((l) => (l.id === lead.id ? { ...l, siteAudit: audit } : l)),
          );
          setDrawerLeadId(lead.id);
        } else {
          // // FIX (PROBLÈME 1) : cause précise loguée + message clair en français.
          logError("siteCheck", new Error("Analyse de site sans résultat"), {
            commerce: lead.venue.name,
            site: lead.venue.website,
          });
          setAuditError(
            `Impossible d'analyser le site de « ${lead.venue.name} » : le site n'a pas répondu (ou le service d'analyse est indisponible). Réessayez dans un instant.`,
          );
        }
      } catch (err) {
        logError("siteCheck", err, { commerce: lead.venue.name });
        setAuditError(`Analyse de site impossible : ${describeError(err)}`);
      } finally {
        setSiteCheckingId(null);
      }
    },
    [aiSettings, aiConfigured, siteCheckingId],
  );

  const handleSelectPlace = useCallback(
    (place: GeoPlace, runImmediately?: boolean) => {
      setSelectedPlace(place);
      setScanError(null);
      setUsingCache(false);
      if (runImmediately) {
        // Entrée dans le champ ville : on enchaîne directement sur l'analyse.
        void analyzeArea(place);
        return;
      }
      // // FIX (PROBLÈME 2) : message d'étape en français, cohérent partout.
      setStatusMsg(`${place.shortName} sélectionné — prêt à analyser.`);
    },
    [analyzeArea],
  );

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
    <>
      {/*
       * FIX (UI) : le composant ChromeCells fourni sert de FOND à toute
       * l'application (canvas WebGL plein écran), avec un voile sombre pour
       * garantir la lisibilité des données par-dessus.
       */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <ChromeCells style={{ minWidth: 0, minHeight: 0 }} />
        <div className="absolute inset-0 bg-slate-950/65" />
      </div>

      <div className="bg-grid relative z-10 flex h-full w-full flex-col overflow-hidden">
      <TopBar
        stats={stats}
        onOpenSettings={() => setSettingsOpen(true)}
        settingsOk={aiConfigured}
        onHome={() => setEntered(false)}
      />

      {/* Scan bar */}
      <div className="border-b border-white/10 bg-black/45 px-4 py-2.5 backdrop-blur-xl">
        {/* FIX (mobile) : la barre passe à la ligne au lieu de comprimer la recherche. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <Crosshair size={15} className="shrink-0 text-accent" />
          <CitySearch
            value={cityQuery}
            onChange={setCityQuery}
            onSelect={handleSelectPlace}
            /* Entrée sans suggestion en attente : relance l'analyse de la ville
               déjà choisie (le bouton juste à côté reste le chemin principal). */
            onSubmit={() => void analyzeArea()}
            disabled={scanning}
          />
          <Button
            variant="primary"
            onClick={() => void analyzeArea()}
            disabled={scanning || !selectedPlace}
            title={selectedPlace ? `Analyser ${selectedPlace.shortName}` : "Choisissez d'abord une ville"}
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
            {scanning ? "Analyse…" : "Analyser la zone"}
          </Button>
          <Button
            size="md"
            variant={showFilters ? "primary" : "default"}
            onClick={() => setShowFilters((v) => !v)}
            className="xl:hidden"
            title="Filtres"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filtres</span>
          </Button>
        </div>
      </div>

      {/*
       * FIX (PROBLÈME 2 — mobile) : barre d'état NON BLOQUANTE avec spinner,
       * message d'étape en français et chronomètre en direct ; en cas d'échec, un
       * bouton « Réessayer » immédiat (plus jamais d'écran vide sans explication).
       */}
      {scanning || scanError || statusMsg ? (
        <div
          className={`flex items-center gap-2 border-b px-4 py-1.5 font-mono text-[11px] ${
            scanError
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-white/10 bg-black/45 text-slate-300 backdrop-blur-xl"
          }`}
        >
          {scanning ? (
            <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
          ) : (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                scanError
                  ? "bg-red-400 shadow-[0_0_10px_rgba(168,40,63,0.95)]"
                  : "dot-accent"
              }`}
            />
          )}
          <span className="truncate">{scanError ?? scanStep ?? statusMsg}</span>
          {scanning ? (
            <span className="ml-auto shrink-0 tabular-nums text-slate-500">
              {(scanElapsedMs / 1000).toFixed(1)} s
            </span>
          ) : null}
          {scanError ? (
            <Button size="sm" onClick={() => void analyzeArea()} className="ml-auto shrink-0">
              <RotateCcw size={11} /> Réessayer
            </Button>
          ) : null}
          {/*
           * // FIX (honnêteté) : le repli par l'analyse n'est proposé que si la
           * cartographie a échoué, et il faut l'ACCEPTER — ces pistes sont
           * générées par le modèle, elles ne remplacent pas un relevé.
           */}
          {scanError && aiFallbackOffered && !scanning ? (
            <Button
              size="sm"
              variant="danger"
              className={scanError ? "shrink-0" : "ml-auto shrink-0"}
              onClick={() => void analyzeArea(undefined, { allowAi: true })}
              title="Pistes reconstituées par l'analyse : noms et adresses non vérifiés"
            >
              <Radar size={11} /> Pistes par l'analyse
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* FIX (PROBLÈME 2) : bandeau « résultats en cache » quand le réseau a lâché. */}
      {usingCache ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 font-mono text-[11px] text-amber-300">
          <Database size={12} className="shrink-0" />
          <span>
            Résultats en cache — dernier scan réussi{" "}
            {scanSummary?.scannedAt ? new Date(scanSummary.scannedAt).toLocaleString() : "précédemment"}
            {scanSummary ? ` · ${scanSummary.city}` : ""} ({leads.length} commerces). Relancez
            l'analyse dès que le réseau revient.
          </span>
        </div>
      ) : null}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 py-5">
          {/* Results banner */}
          <div className="glass glass-live rounded-2xl bg-gradient-to-r from-accent/12 via-transparent to-transparent px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <Trophy size={18} className="shrink-0 text-accent" />
                  <span className="text-chrome">{scanSummary ? scanSummary.city : "Résultats"}</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {scanSummary ? (
                    <>
                      <span className="font-mono font-semibold text-chrome">{scanSummary.total}</span> commerces
                      analysés · <span className="font-semibold text-red-300">{scanSummary.high} cibles prioritaires</span>
                      {scanSummary.capped ? " · analyse plafonnée (affinez sur un quartier)" : ""} — classés par
                      présence numérique la plus faible
                      {/* // FIX (honnêteté) : quand OpenStreetMap n'a pas répondu,
                          on le DIT au lieu de faire passer une estimation pour
                          un relevé terrain. */}
                      {scanSummary.origin === "ia" ? (
                        <>
                          {" "}
                          <span className="text-red-300">
                            · OpenStreetMap indisponible : pistes reconstituées par l'analyse, noms et
                            adresses NON vérifiés — à confirmer avant tout démarchage
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    "Lancez une analyse pour afficher les prospects classés ici"
                  )}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {siteScan.active ? (
                  <Button variant="danger" onClick={stopSiteChecks}>
                    <Square size={13} /> Arrêter ({siteScan.done}/{siteScan.total})
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={runSiteChecks}
                    disabled={
                      !aiConfigured ||
                      !leads.some((l) => l.enrichment.checks.hasWebsite && l.venue.website)
                    }
                    title="Contrôler la qualité des sites existants : vitesse, HTTPS, contenu"
                  >
                    <Gauge size={13} />
                    Vérifier les sites
                    {siteScan.total > 0 && !siteScan.active
                      ? ` (${siteScan.done}/${siteScan.total})`
                      : ""}
                  </Button>
                )}
                {siteScan.last ? (
                  <span className="font-mono text-[10px] text-slate-500">
                    dernier : {siteScan.last}
                  </span>
                ) : null}
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
                    title="Effacer tous les résultats"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Supprimer tous les commerces analysés et les résultats enregistrés ?",
                        )
                      ) {
                        return;
                      }
                      setLeads([]);
                      setScanSummary(null);
                      setSelectedId(null);
                      setDrawerLeadId(null);
                    }}
                  >
                    <RotateCcw size={13} /> Réinitialiser
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
              <div className="glass glass-sheen xl:sticky xl:top-2 rounded-2xl px-4 py-3">
                <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Filtres
                </h3>
                <FiltersPanel
                  venueTypes={venueTypes}
                  digital={digital}
                  onVenueTypes={setVenueTypes}
                  onDigital={setDigital}
                />
                {scans.length > 0 ? (
                  <p className="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-slate-600">
                    Dernières analyses :
                    <br />
                    {scans
                      .slice(0, 3)
                      .map((s) => `${s.city} (${s.totalFound})`)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            </aside>

            {/* Sans `overflow-hidden` : les aperçus de sites (Link Preview) qui
                s'ouvrent au-dessus des premières lignes ne sont plus rognés. */}
            <div className="glass rounded-2xl">
              <LeadsTable
                leads={sortedLeads}
                selectedId={selectedId}
                onSelect={focusLead}
                onAudit={(lead) => {
                  focusLead(lead);
                  openDrawer(lead);
                  runAudit(lead);
                }}
                onSiteCheck={(lead) => {
                  focusLead(lead);
                  runSiteCheckOne(lead);
                }}
                auditingId={auditingId}
                siteCheckingId={siteCheckingId}
              />
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-relaxed text-slate-600">
            Données © contributeurs OpenStreetMap (ODbL). Les rapports et messages générés sont
            indicatifs et doivent être vérifiés avant tout démarchage. À utiliser de manière
            responsable :{" "}
            <a href="#/mentions-legales" className="underline decoration-slate-700 hover:text-accent">
              mentions légales
            </a>{" "}
            ·{" "}
            <a href="#/confidentialite" className="underline decoration-slate-700 hover:text-accent">
              confidentialité
            </a>{" "}
            ·{" "}
            <a href="#/cgu" className="underline decoration-slate-700 hover:text-accent">
              CGU
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
    </>
  );
}
