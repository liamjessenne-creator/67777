/**
 * Optional Google Places enrichment (New Places API).
 * Fully optional: without a key, OSM heuristics drive the score.
 * Stored in localStorage alongside AI settings.
 */

// FIX (PROBLÈME 1 & 2) : timeout 8 s + 2 tentatives, erreurs explicites en français.
import { NetworkError, fetchWithRetry } from "./net";

export interface PlacesSettings {
  apiKey: string;
  enabled: boolean;
}

export const DEFAULT_PLACES_SETTINGS: PlacesSettings = {
  apiKey: "",
  enabled: false,
};

interface PlacesTextSearchResponse {
  places?: Array<{
    displayName?: { text?: string };
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    websiteUri?: string;
    businessStatus?: string;
    formattedAddress?: string;
  }>;
}

export interface PlacesLookup {
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  businessStatus: string | null;
}

/**
 * Text search for one venue. Note: Google requires an HTTP referrer-restricted
 * key or a proxy for production use; for an internal audit tool a plain key works.
 */
export async function lookupPlace(
  settings: PlacesSettings,
  name: string,
  address: string,
  signal?: AbortSignal,
): Promise<PlacesLookup | null> {
  if (!settings.apiKey) return null;

  // FIX (PROBLÈME 1 & 3) : 8 s maximum + 2 tentatives (backoff exponentiel).
  // Ces appels partent en parallèle par lots — voir mapLimit dans net.ts.
  const res = await fetchWithRetry("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": settings.apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.businessStatus,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: `${name} ${address}`, maxResultCount: 1 }),
    timeoutMs: 8_000,
    attempts: 2,
    baseDelayMs: 500,
    label: "Google Places",
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new NetworkError(
      `Fiche Google indisponible (HTTP ${res.status}). ${detail.slice(0, 120)}`,
      res.status,
    );
  }
  const json = (await res.json()) as PlacesTextSearchResponse;
  const place = json.places?.[0];
  if (!place) return null;
  return {
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    website: place.websiteUri ?? null,
    businessStatus: place.businessStatus ?? null,
  };
}
