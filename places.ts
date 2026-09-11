/**
 * Optional Google Places enrichment (New Places API).
 * Fully optional: without a key, OSM heuristics drive the score.
 * Stored in localStorage alongside AI settings.
 */

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

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": settings.apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.businessStatus,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: `${name} ${address}`, maxResultCount: 1 }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Google Places error ${res.status}: ${await res.text()}`);
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
