/**
 * City search + geocoding.
 * Primary: OpenStreetMap Nominatim (no key).
 * Fallback: Photon (komoot) when Nominatim is rate-limited/unavailable.
 */

export interface GeoPlace {
  osmId: number;
  osmType: string;
  displayName: string;
  shortName: string;
  country: string | null;
  lat: number;
  lon: number;
  /** bounding box: [south, north, west, east] */
  boundingBox: [number, number, number, number] | null;
  /** OSM area id usable directly in Overpass area queries (3600000000 + relation id) */
  areaId: number | null;
  /** True when this result is the commune/town/village itself (not its parent region) */
  isLocality: boolean;
}

// FIX (PROBLÈME 1 & 2) : timeouts + retry + erreurs en français via net.ts.
// Avant : un fetch sans timeout pouvait pendre indéfiniment sur réseau mobile
// lent → l'autocomplétion « ne faisait rien », sans aucune erreur visible.
import { NetworkError, describeError, fetchWithRetry, logError } from "./net";

interface NominatimSearchItem {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
  boundingbox?: string[];
}

interface PhotonFeature {
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_type?: string;
    osm_id?: number;
    type?: string;
  };
  geometry?: { coordinates?: number[] };
  bbox?: number[];
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const PHOTON_BASE = "https://photon.komoot.io/api";

async function searchNominatim(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");

  // FIX (PROBLÈME 1) : timeout 10 s (autocomplétion = doit rester réactive) + 2 essais.
  const res = await fetchWithRetry(url.toString(), {
    timeoutMs: 10_000,
    attempts: 2,
    baseDelayMs: 500,
    label: "Nominatim",
    signal,
  });
  if (!res.ok) {
    throw new NetworkError(`Recherche de ville indisponible (Nominatim : HTTP ${res.status}).`, res.status);
  }
  const data = (await res.json()) as NominatimSearchItem[];

  const places = data.map((item) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const bb = item.boundingbox?.map(Number);
    const boundingBox: [number, number, number, number] | null =
      bb && bb.length === 4 ? [bb[0], bb[1], bb[2], bb[3]] : null;
    const osmType = item.osm_type ?? "relation";
    const osmId = item.osm_id ?? 0;
    const shortName =
      item.name ??
      item.address?.city ??
      item.address?.town ??
      item.address?.village ??
      query;
    return {
      osmId,
      osmType,
      displayName: item.display_name ?? query,
      shortName,
      country: item.address?.country ?? null,
      lat,
      lon,
      boundingBox,
      areaId: osmType === "relation" && osmId ? 3600000000 + osmId : null,
      /** The commune/town/village itself (not its county/metropole/region parent) */
      isLocality:
        (item.address?.city ?? item.address?.town ?? item.address?.village ?? "")
          .toLowerCase() === shortName.toLowerCase(),
    };
  });

  // City (commune) results first, county/metropole/state parents last:
  // scanning "Lyon" should target the city itself, not the whole métropole.
  return places.sort((a, b) => Number(b.isLocality) - Number(a.isLocality));
}

async function searchPhoton(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = new URL(PHOTON_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");

  // FIX (PROBLÈME 1) : même protection que Nominatim (timeout + retry).
  const res = await fetchWithRetry(url.toString(), {
    timeoutMs: 10_000,
    attempts: 2,
    baseDelayMs: 500,
    label: "Photon",
    signal,
  });
  if (!res.ok) {
    throw new NetworkError(`Recherche de ville indisponible (Photon : HTTP ${res.status}).`, res.status);
  }
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const features = json.features ?? [];

  return features
    .filter((f) => f.properties?.name && Array.isArray(f.geometry?.coordinates))
    .map((f) => {
      const p = f.properties!;
      const [lon, lat] = f.geometry!.coordinates as [number, number];
      const osmType =
        p.osm_type === "R" ? "relation" : p.osm_type === "W" ? "way" : p.osm_type === "N" ? "node" : "relation";
      const osmId = p.osm_id ?? 0;
      const place = [p.city ?? p.name, p.state, p.country].filter(Boolean).join(", ");
      const shortName = p.city ?? p.name!;
      const bboxRaw = f.bbox;
      const boundingBox: [number, number, number, number] | null =
        bboxRaw && bboxRaw.length === 4
          ? [bboxRaw[1], bboxRaw[3], bboxRaw[0], bboxRaw[2]] // photon: [minLon, minLat, maxLon, maxLat]
          : null;
      const isLocality = ["city", "town", "village", "borough", "locality", "suburb"].includes(
        f.properties?.type ?? "",
      );
      return {
        osmId,
        osmType,
        displayName: `${p.name}${place ? `, ${place}` : ""}`,
        shortName,
        country: p.country ?? null,
        lat,
        lon,
        boundingBox,
        areaId: osmType === "relation" && osmId ? 3600000000 + osmId : null,
        isLocality,
      };
    });
}

/** Search with Nominatim, falling back to Photon. Throws if both fail. */
export async function searchCity(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  let nominatimError: unknown = null;
  try {
    const results = await searchNominatim(query, signal);
    if (results.length > 0) return results;
  } catch (err) {
    if (signal?.aborted) throw err; // annulation volontaire → on ne bascule pas de fournisseur
    nominatimError = err;
    logError("nominatim", err, { provider: "Nominatim", query });
  }

  try {
    const results = await searchPhoton(query, signal);
    if (results.length > 0) return results;
  } catch (err) {
    logError("nominatim", err, { provider: "Photon", query });
    if (nominatimError) {
      // FIX (PROBLÈME 1) : message clair en français, avec la cause exacte en console.
      throw new NetworkError(
        `Recherche de ville impossible : les deux services de géocodage sont injoignables ` +
          `(${describeError(nominatimError)}). Vérifiez votre connexion puis réessayez.`,
      );
    }
    throw err;
  }
  return [];
}

/** Overpass bbox string "south,west,north,east" from a Nominatim bounding box. */
export function bboxString(bb: [number, number, number, number]): string {
  const [south, north, west, east] = bb;
  return `${south},${west},${north},${east}`;
}