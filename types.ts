/** Shared domain types for GeoLead Finder AI. */

export type VenueType =
  | "restaurant"
  | "fast_food"
  | "cafe"
  | "bar"
  | "bakery"
  | "pub";

export type LeadStatus = "new" | "analyzed" | "contacted";

export type PriorityTier = "high" | "medium" | "low";

/** Venue as extracted from OpenStreetMap / Overpass. */
export interface Venue {
  /** Stable id: node/123456 or way/123456 */
  id: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string;
  venueType: VenueType;
  lat: number;
  lon: number;
  address: string;
  phone: string | null;
  website: string | null;
  cuisine: string | null;
  openingHours: string | null;
  /** OSM opening-hours heuristic — "no hours recorded" is treated as unknown, not closed */
  openHoursRecorded: boolean;
  rawTags: Record<string, string>;
}

/** Result of digital-presence enrichment for one venue. */
export interface Enrichment {
  /** 0–100 computed score */
  digitalScore: number;
  priority: PriorityTier;
  checks: {
    hasWebsite: boolean;
    hasSocial: boolean;
    hasPhone: boolean;
    reviewsKnown: boolean;
    reviewCount: number | null;
    rating: number | null;
    /** Populated only when a Google Places key is configured */
    source: "osm-heuristic" | "google-places";
  };
  /** Human-readable reasons driving the score */
  signals: string[];
}

/** A lead = venue + enrichment + optional AI audit + workflow status. */
export interface Lead {
  id: string;
  venue: Venue;
  enrichment: Enrichment;
  status: LeadStatus;
  audit?: AiAudit;
  /** Result of the "site check" pass (quality of an EXISTING website). */
  siteAudit?: SiteAudit;
  addedAt: string;
}

export interface AiAudit {
  gapReport: string;
  outreach: string;
  actionPlan: string[];
  generatedAt: string;
  model: string;
  /** Official website discovered (and optionally verified) by the AI agent. */
  website: { url: string; verified: boolean } | null;
  /**
   * // FIX (PROBLÈME 1) : échecs partiels non bloquants (ex. plan d'action refusé
   * par le fournisseur IA). Affichés à l'utilisateur au lieu de disparaître.
   */
  warnings?: string[];
}

/**
 * Technical checks gathered in the browser (no API key) for an existing
 * website — fed to the AI together with the homepage text when reachable.
 */
export interface SiteChecks {
  reachable: boolean;
  https: boolean;
  loadMs: number | null;
  title: string | null;
  contentChars: number;
  /** Contact info (email/phone) findable on the homepage */
  hasContact: boolean;
  /** Social / delivery links present on the homepage */
  hasSocialLinks: boolean;
  /** false = page is JS-rendered or blocked the fetch → content unknown */
  contentReliable: boolean;
}

export type SiteVerdict = "good" | "improve" | "critical";

/** Result of the AI "site check" for a venue that already has a website. */
export interface SiteAudit {
  url: string;
  checks: SiteChecks;
  verdict: SiteVerdict;
  /** 1–2 sentence explanation for the salesperson */
  summary: string;
  /** 3–5 concrete, sellable improvement actions */
  improvements: string[];
  generatedAt: string;
  model: string;
}

export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: AiModelId;
}

/**
 * Modèles actifs sur Groq — liste VÉRIFIÉE en direct sur l'API du compte
 * (les modèles Llama n'y sont plus exposés : tout ID retiré renvoie un 404).
 * gpt-oss-20b sert d'étapes rapides (JSON courts, découverte de site),
 * gpt-oss-120b de modèle principal pour les rapports rédigés.
 */
export const AI_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "groq/compound-mini",
  "groq/compound",
] as const;

/** Preset IDs or any custom model id typed by the user (other providers). */
export type AiModelId = (typeof AI_MODELS)[number] | (string & {});

/** Top-level app "page": the tool itself or a static informational/legal page. */
export type Role = "app" | "legal";
/** Which static/legal page is displayed when role === "legal". */
export type LegalPage = "mentions" | "privacy" | "terms";

/**
 * Defaults — the API key comes from `.env.local` (`VITE_GROQ_API_KEY=…`,
 * gitignored) so the app works out of the box locally without committing any
 * secret. It can always be changed/overridden in Settings (persisted to
 * localStorage); a fresh clone just pastes its key once in Settings.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  // // FIX (CONTRAINTE) : la clé ne doit JAMAIS être en dur. Elle est lue dans
  // l'environnement au build (`GROQ_API_KEY`), avec le préfixe `VITE_` requis
  // par Vite pour exposer une variable au client, ou saisie une fois dans
  // ⚙ Réglages (stockée uniquement dans le localStorage du navigateur).
  apiKey: import.meta.env?.VITE_GROQ_API_KEY ?? import.meta.env?.GROQ_API_KEY ?? "",
  baseUrl: "https://api.groq.com/openai/v1",
  // Modèle principal par défaut : le plus capable du catalogue Groq actuel.
  model: "openai/gpt-oss-120b",
};

export interface ScanMeta {
  city: string;
  displayName: string;
  lat: number;
  lon: number;
  radiusKm: number;
  scannedAt: string;
  totalFound: number;
}

export interface VenueTypeFilter {
  restaurant: boolean;
  fast_food: boolean;
  cafe: boolean;
  bar: boolean;
  bakery: boolean;
  pub: boolean;
}

export interface DigitalFilters {
  noWebsiteOnly: boolean;
  maxReviews: number | null;
  highPriorityOnly: boolean;
}

export type MapPinColor = "red" | "yellow" | "green";

export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  restaurant: "Restaurant",
  fast_food: "Restauration rapide",
  cafe: "Café",
  bar: "Bar",
  bakery: "Boulangerie / Pâtisserie",
  pub: "Pub",
};

/** Libellés français des statuts de suivi (interface 100 % francophone). */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "nouveau",
  analyzed: "analysé",
  contacted: "contacté",
};

/** Map an OSM amenity/cuisine tag combo to a simplified venue type. */
export function resolveVenueType(tags: Record<string, string>): VenueType {
  const amenity = tags["amenity"];
  const cuisine = (tags["cuisine"] ?? "").toLowerCase();
  const shop = tags["shop"];
  if (shop === "bakery" || amenity === "bakery" || cuisine.includes("bakery")) {
    return "bakery";
  }
  if (amenity === "fast_food" || cuisine.includes("kebab") || cuisine.includes("pizza") || cuisine.includes("burger") || cuisine.includes("sandwich")) {
    return "fast_food";
  }
  if (amenity === "cafe") return "cafe";
  if (amenity === "bar") return "bar";
  if (amenity === "pub") return "pub";
  return "restaurant";
}
