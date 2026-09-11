/** localStorage persistence — settings, scanned cities and leads. */

import type { AiSettings, Lead, ScanMeta } from "./types";
import { DEFAULT_AI_SETTINGS } from "./types";
import type { PlacesSettings } from "./places";
import { DEFAULT_PLACES_SETTINGS } from "./places";

const KEYS = {
  aiSettings: "glf.aiSettings",
  placesSettings: "glf.placesSettings",
  leads: "glf.leads",
  scans: "glf.scans",
  lastCity: "glf.lastCity",
  scanSummary: "glf.scanSummary",
  activeView: "glf.activeView",
  entered: "glf.entered",
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
    baseUrl: s.baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
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

export function saveLeads(leads: Lead[]): void {
  write(KEYS.leads, leads);
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

/** Landing → tool gate: remember that the user already entered the tool. */
export function loadEntered(): boolean {
  return read<boolean>(KEYS.entered, false);
}

export function saveEntered(v: boolean): void {
  write(KEYS.entered, v);
}
