/**
 * Overpass API client — queries OpenStreetMap for food venues inside a city area.
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import type { Venue } from "./types";
import { resolveVenueType } from "./types";
import type { GeoPlace } from "./nominatim";
import { bboxString } from "./nominatim";
// FIX (PROBLÈME 1 & 2) : infrastructure commune — timeout explicite, retry
// exponentiel, erreurs en français et logs console systématiques.
import { NetworkError, describeError, fetchWithRetry, logError, logInfo, sleep } from "./net";

/**
 * Public Overpass mirrors, tried in order. The two main mirrors shed load
 * under burst traffic (429/504), so we keep an independent fallback and
 * retry each mirror with linear backoff before moving on. Order matters:
 * private.coffee proved the most resilient during the 2026-09 overload.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export interface OverpassQueryOptions {
  types?: string[];
  signal?: AbortSignal;
  /** Budget TOTAL de la recherche de commerces (défaut 28 s) — pas par tentative. */
  timeoutMs?: number;
  /** // FIX (PROBLÈME 2) : informe l'UI du miroir essayé (message d'étape). */
  onProgress?: (info: { host: string; attempt: number; total: number }) => void;
}

export interface OverpassResult {
  venues: Venue[];
  endpointUsed: string;
  /** // FIX (PROBLÈME 3) : chronométrage de l'étape, affiché dans l'UI */
  durationMs: number;
}

const AMENITIES = ["restaurant", "fast_food", "cafe", "bar", "pub", "bakery"];

function buildQuery(place: GeoPlace, amenities: string[]): string {
  const amenityRegex = `^(${amenities.join("|")})$`;
  const foodSelector = `nwr[amenity~"${amenityRegex}"]`;
  const bakerySelector = `nwr[shop~"^(bakery|pastry)$"][name]`;

  // FIX (PROBLÈME 2 — mobile) : plafond de résultats ramené de 3000 à 800.
  // L'UI ne conserve que 700 commerces : demander 3000 éléments faisait
  // transiter ~4x trop de données sur un réseau mobile lent.
  if (place.areaId) {
    return `[out:json][timeout:60];
area(${place.areaId})->.searchArea;
(
  ${foodSelector}(area.searchArea);
  ${bakerySelector}(area.searchArea);
);
out center 800;`;
  }
  if (!place.boundingBox) {
    throw new NetworkError("Ce lieu n'a ni zone ni emprise géographique exploitable.");
  }
  const bbox = bboxString(place.boundingBox);
  return `[out:json][timeout:60];
(
  ${foodSelector}(${bbox});
  ${bakerySelector}(${bbox});
);
out center 800;`;
}

function elementToVenue(el: OverpassElement): Venue | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const shop = tags.shop;
  const amenity = tags.amenity;
  const isFood =
    AMENITIES.includes(amenity ?? "") ||
    shop === "bakery" ||
    shop === "pastry";
  if (!isFood) return null;

  const street = [tags["addr:housenumber"], tags["addr:street"]]
    .filter(Boolean)
    .join(" ");
  const city = tags["addr:city"] ?? "";
  const postcode = tags["addr:postcode"] ?? "";
  const address = [street, [postcode, city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const hours = tags.opening_hours?.trim() ?? "";
  return {
    id: `${el.type}/${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name,
    venueType: resolveVenueType(tags),
    lat,
    lon,
    address: address || "—",
    phone: tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"] ?? null,
    website:
      tags.website ??
      tags["contact:website"] ??
      tags["contact:facebook"] ??
      tags["contact:instagram"] ??
      null,
    cuisine: tags.cuisine ?? null,
    openingHours: hours || null,
    openHoursRecorded: hours.length > 0,
    rawTags: tags,
  };
}

export async function queryVenues(
  place: GeoPlace,
  opts: OverpassQueryOptions = {},
): Promise<OverpassResult> {
  const query = buildQuery(place, opts.types ?? AMENITIES);
  const errors: string[] = [];
  const startedAt = Date.now();
  /** // FIX (PROBLÈME 1) : 15 s maximum PAR TENTATIVE (consigne explicite). */
  const PER_ATTEMPT_TIMEOUT_MS = 15_000;
  /**
   * // FIX (PROBLÈME 3) : budget TOTAL borné (28 s par défaut).
   * Avant : 3 miroirs × 2 tentatives × 15 s = jusqu'à 90 s d'attente —
   * exactement le « c'est trop long » remonté par l'utilisateur.
   * Désormais on essaie CHAQUE miroir une fois (3 tentatives au total, donc le
   * retry demandé) avec un backoff exponentiel entre miroirs, et on s'arrête
   * proprement dès que le budget est consommé.
   */
  const TOTAL_BUDGET_MS = opts.timeoutMs ?? 28_000;
  const deadlineAt = startedAt + TOTAL_BUDGET_MS;

  for (let index = 0; index < OVERPASS_ENDPOINTS.length; index++) {
    const endpoint = OVERPASS_ENDPOINTS[index];
    const host = new URL(endpoint).hostname;
    // Plus assez de temps pour une tentative utile → on s'arrête là.
    if (deadlineAt - Date.now() < 3_000) {
      errors.push(`${host} → ignoré (budget de temps épuisé)`);
      break;
    }
    // Backoff exponentiel ENTRE miroirs : 600 ms puis 1 200 ms.
    if (index > 0) await sleep(600 * 2 ** (index - 1));
    opts.onProgress?.({ host, attempt: index + 1, total: OVERPASS_ENDPOINTS.length });
    try {
      const remaining = Math.max(3_000, deadlineAt - Date.now());
      const res = await fetchWithRetry(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }).toString(),
        timeoutMs: Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining),
        attempts: 1,
        baseDelayMs: 800,
        label: `Overpass ${host}`,
        signal: opts.signal,
      });

      if (!res.ok) {
        // Erreur non retentable (ex. requête invalide) → miroir suivant.
        errors.push(`${host} → HTTP ${res.status}`);
        logError("overpass", new Error(`HTTP ${res.status} renvoyé par ${host}`));
        continue;
      }

      const json = (await res.json()) as OverpassResponse;
      const venues: Venue[] = [];
      const seen = new Set<string>();
      for (const el of json.elements ?? []) {
        const venue = elementToVenue(el);
        if (venue && !seen.has(venue.id)) {
          seen.add(venue.id);
          venues.push(venue);
        }
      }
      venues.sort((a, b) => a.name.localeCompare(b.name));
      const durationMs = Date.now() - startedAt;
      logInfo("overpass", `${venues.length} commerces via ${host} en ${durationMs} ms`);
      return { venues, endpointUsed: host, durationMs };
    } catch (err) {
      // Annulation volontaire de l'utilisateur : on propage sans retry.
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      errors.push(`${host} → ${describeError(err)}`);
      logError("overpass", err, { mirror: host });
    }
  }

  // FIX (PROBLÈME 1) : message clair en français + erreur exacte en console.
  const detail = errors.length > 0 ? ` (${errors.join(" · ")})` : "";
  throw new NetworkError(
    `Aucun serveur OpenStreetMap n'a répondu${detail}. ` +
      "Les miroirs publics sont parfois surchargés : patientez quelques secondes puis relancez l'analyse.",
  );
}
