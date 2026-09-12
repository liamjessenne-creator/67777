/**
 * Overpass API client — queries OpenStreetMap for food venues inside a city area.
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import type { Venue } from "./types";
import { resolveVenueType } from "./types";
import type { GeoPlace } from "./nominatim";
import { bboxString } from "./nominatim";

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
  /** Rate limit guard: Overpass caches are per-mirror; 2 s between heavy queries */
  timeoutMs?: number;
}

const AMENITIES = ["restaurant", "fast_food", "cafe", "bar", "pub", "bakery"];

function buildQuery(place: GeoPlace, amenities: string[]): string {
  const amenityRegex = `^(${amenities.join("|")})$`;
  const foodSelector = `nwr[amenity~"${amenityRegex}"]`;
  const bakerySelector = `nwr[shop~"^(bakery|pastry)$"][name]`;

  if (place.areaId) {
    return `[out:json][timeout:60];
area(${place.areaId})->.searchArea;
(
  ${foodSelector}(area.searchArea);
  ${bakerySelector}(area.searchArea);
);
out center 3000;`;
  }
  if (!place.boundingBox) {
    throw new Error("Selected place has neither an area nor a bounding box");
  }
  const bbox = bboxString(place.boundingBox);
  return `[out:json][timeout:60];
(
  ${foodSelector}(${bbox});
  ${bakerySelector}(${bbox});
);
out center 3000;`;
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
): Promise<{ venues: Venue[]; endpointUsed: string }> {
  const query = buildQuery(place, opts.types ?? AMENITIES);
  const errors: string[] = [];

  /** Public mirrors shed load with 429/502/503/504 on bursty queries. */
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const RETRYABLE = new Set([429, 502, 503, 504]);
  const MAX_ATTEMPTS = 2;
  /** Cap each attempt so a hung mirror cannot stall the scan (observed: 48 s). */
  const PER_ATTEMPT_TIMEOUT_MS = 25_000;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const host = new URL(endpoint).hostname;
      // Link the caller's abort signal with our per-attempt timeout.
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();
      opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(),
          signal: controller.signal,
        });
        if (!res.ok) {
          errors.push(`${host} → HTTP ${res.status}${attempt < MAX_ATTEMPTS ? " (retrying)" : ""}`);
          if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
            await sleep(2500 * attempt); // 2.5s
            continue;
          }
          break; // non-retryable (or attempts exhausted) → next mirror
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
        return { venues, endpointUsed: host };
      } catch (err) {
        // A user-triggered abort must propagate; our own timeout is retryable.
        if (opts.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const msg =
          err instanceof DOMException && err.name === "AbortError"
            ? `timeout after ${PER_ATTEMPT_TIMEOUT_MS / 1000}s`
            : err instanceof Error
              ? err.message
              : String(err);
        errors.push(`${host} → ${msg}${attempt < MAX_ATTEMPTS ? " (retrying)" : ""}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2500 * attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onOuterAbort);
      }
    }
  }
  throw new Error(
    `All Overpass mirrors failed:\n${errors.join("\n")}\nTip: the public mirrors shed load under burst traffic — wait a few seconds and retry.`,
  );
}
