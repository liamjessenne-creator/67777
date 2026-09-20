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

/**
 * Provenance d'une fiche commerce :
 *  - `osm` : relevé OpenStreetMap (source cartographique, terrain) ;
 *  - `ia`  : reconstitution par le modèle quand aucun miroir OSM ne répond.
 * Les fiches `ia` sont signalées comme ESTIMÉES dans l'interface : ce n'est
 * pas un relevé terrain, il faut vérifier avant de démarcher.
 */
export type VenueOrigin = "osm" | "ia";

/** Venue as extracted from OpenStreetMap / Overpass (or estimated by the model). */
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
  /** Source de la fiche (voir VenueOrigin). Absent = `osm` (anciens caches). */
  origin?: VenueOrigin;
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
  /**
   * // FIX (remplacement de Groq) : URL de la passerelle d'analyse. Défaut
   * `/api/llm` — proxy Vite en local, fonction serverless Vercel en production.
   * La clé du serveur IA ne transite jamais par le navigateur.
   */
  proxyUrl?: string;
}

/**
 * // FIX (IA en ligne) : modèles proposés — le pool gratuit OpenRouter (mesuré
 * en direct) + le routeur « auto » du serveur local. L'utilisateur peut aussi
 * saisir n'importe quel autre identifiant compatible OpenAI.
 */
export const AI_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "nex-agi/nex-n2.5-mini:free",
  "z-ai/glm-5.2:free",
  "google/gemma-4-31b-it:free",
  "auto",
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
  // // FIX (IA en ligne) : la clé vit côté serveur (`.env.local` → proxy Vite
  // /api/llm ; LLM_API_KEY Vercel → api/llm.js). Le champ ci-dessous n'est pas
  // utilisé par le chemin normal.
  apiKey: "",
  // URL directe du fournisseur (OpenRouter hébergé par défaut, serveur local
  // possible). Le chemin NORMAL passe par la passerelle (`proxyUrl`).
  baseUrl: "https://openrouter.ai/api/v1",
  // Modèle principal : rapports rédigés (qualité française mesurée).
  model: "nex-agi/nex-n2.5-pro:free",
  // Passerelle d'analyse : vide = /api/llm (même origine, voir llmGateway.ts).
  proxyUrl: "",
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
