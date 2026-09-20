/** localStorage persistence — settings, scanned cities and leads. */

import type { AiSettings, Lead, ScanMeta } from "./types";
import { DEFAULT_AI_SETTINGS } from "./types";
import type { PlacesSettings } from "./places";
import { DEFAULT_PLACES_SETTINGS } from "./places";

const KEYS = {
  // FIX (remplacement de Groq) : clé versionnée — les anciens réglages
  // persistés (modèle Groq, URL de passerelle Supabase, clé gsk_…) ne doivent
  // pas écraser les nouveaux défauts du serveur IA local.
  // FIX (choix du fournisseur) : v3 — introduit `provider`.
  aiSettings: "glf.aiSettings.v3",
  placesSettings: "glf.placesSettings",
  leads: "glf.leads",
  scans: "glf.scans",
  lastCity: "glf.lastCity",
  scanSummary: "glf.scanSummary",
  activeView: "glf.activeView",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — non-fatal for the UI.
  }
}

export function loadAiSettings(): AiSettings {
  const s = read<Partial<AiSettings>>(KEYS.aiSettings, {});
  return {
    ...DEFAULT_AI_SETTINGS,
    ...s,
    // // FIX (remplacement de Groq) : le routeur « auto » est le seul choix
    // garanti sur le nouveau serveur — un modèle Groq persisté serait rejeté
    // (404 définitif). On n'hérite jamais d'un modèle hors catalogue.
    model: s.model || DEFAULT_AI_SETTINGS.model,
    baseUrl: s.baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
    // // FIX (choix du fournisseur) : valeur contrôlée — un réglage persisté
    // corrompu ne peut pas casser la passerelle.
    provider: s.provider === "local" ? "local" : "openrouter",
  };
}

export function saveAiSettings(settings: AiSettings): void {
  write(KEYS.aiSettings, settings);
}

export function loadPlacesSettings(): PlacesSettings {
  return read<PlacesSettings>(KEYS.placesSettings, DEFAULT_PLACES_SETTINGS);
}

export function savePlacesSettings(settings: PlacesSettings): void {
  write(KEYS.placesSettings, settings);
}

export function loadLeads(): Lead[] {
  return read<Lead[]>(KEYS.leads, []);
}

/**
 * // FIX (PROBLÈME 2 — mobile) : les tags OSM bruts ne sont PAS écrits dans le
 * localStorage. Ils ne servent qu'au calcul du score au moment du scan ; les
 * stocker multipliait la taille (~3x sur un scan de 700 commerces) et ralentissait
 * chaque écriture — critique quand on approche du quota mobile (~5 Mo).
 */
export function saveLeads(leads: Lead[]): void {
  const slim = leads.map((l) => ({ ...l, venue: { ...l.venue, rawTags: {} } }));
  write(KEYS.leads, slim);
}

export function loadScans(): ScanMeta[] {
  return read<ScanMeta[]>(KEYS.scans, []);
}

export function saveScans(scans: ScanMeta[]): void {
  write(KEYS.scans, scans);
}

export function loadLastCity(): string {
  return read<string>(KEYS.lastCity, "");
}

export function saveLastCity(city: string): void {
  write(KEYS.lastCity, city);
}

export interface ScanSummaryData {
  city: string;
  total: number;
  high: number;
  capped: boolean;
  /** // FIX (PROBLÈME 2) : date du dernier scan réussi, affichée quand on
   * retombe sur les résultats en cache (réseau indisponible). */
  scannedAt?: string;
  /** // FIX (PROBLÈME 3) : durée réelle de l'analyse, en millisecondes. */
  durationMs?: number;
  /**
   * // FIX (fiabilité) : provenance de la liste affichée — `osm` (relevé
   * OpenStreetMap) ou `ia` (reconstitution par le modèle quand tous les
   * miroirs publics étaient injoignables). Affiché en clair dans le bandeau.
   */
  origin?: "osm" | "ia";
}

export function loadScanSummary(): ScanSummaryData | null {
  return read<ScanSummaryData | null>(KEYS.scanSummary, null);
}

export function saveScanSummary(s: ScanSummaryData | null): void {
  write(KEYS.scanSummary, s);
}

type ActiveView = "results" | "map";

export function loadActiveView(): ActiveView | null {
  const v = read<ActiveView | null>(KEYS.activeView, null);
  return v === "results" || v === "map" ? v : null;
}

export function saveActiveView(v: ActiveView): void {
  write(KEYS.activeView, v);
}

export function clearAllData(): void {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

