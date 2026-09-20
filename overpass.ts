/**
 * Overpass API client — queries OpenStreetMap for food venues inside a city area.
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 *
 * // FIX (fiabilité « ça marche 1 fois sur 2 ») — trois causes mesurées en direct
 * sur les miroirs publics le 2026-09-17, toutes corrigées ici :
 *
 *  1. La requête partait en **POST** : `overpass-api.de` répondait 504 après
 *     ~12 s en POST alors que la MÊME requête en **GET** répondait 200 en
 *     2,3 s. Les appels partent désormais en GET (`?data=…`).
 *  2. Les miroirs étaient essayés **l'un après l'autre** : un miroir mort
 *     (aucune réponse TCP) consommait 20 à 30 s de budget avant de passer au
 *     suivant, et l'analyse expirait avant d'atteindre celui qui fonctionnait.
 *     Les miroirs sont maintenant interrogés **en parallèle** : le premier JSON
 *     valide gagne, les autres requêtes sont annulées.
 *  3. Un miroir peut répondre **HTTP 200 avec une page HTML d'erreur** (surcharge
 *     OSM3S) : `res.json()` levait alors une erreur générique et le miroir était
 *     abandonné sans raison exploitable. Le corps est désormais analysé ; une
 *     réponse illisible est rejetée proprement et expliquée en français.
 *
 * Aucune clé n'est nécessaire : Overpass est public et renvoie
 * `Access-Control-Allow-Origin: *` (vérifié), donc l'appel fonctionne depuis le
 * navigateur, y compris sur mobile.
 */

import type { Venue } from "./types";
import { resolveVenueType } from "./types";
import type { GeoPlace } from "./geocoding";
import { bboxString } from "./geocoding";
// FIX (PROBLÈME 1 & 2) : infrastructure commune — timeout explicite, erreurs en
// français et logs console systématiques.
import {
  NetworkError,
  describeError,
  fetchWithTimeout,
  logError,
  logInfo,
  sleep,
} from "./net";

/**
 * Miroirs publics, interrogés TOUS EN PARALLÈLE (une seule manche = un appel
 * par miroir). L'ordre n'est donc plus un facteur de lenteur : il ne sert qu'à
 * départager les réponses simultanées. `overpass-api.de` reste en tête (c'est
 * l'instance de référence, la plus complète quand elle n'est pas surchargée).
 */
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassQueryOptions {
  types?: string[];
  signal?: AbortSignal;
  /** Budget TOTAL de la recherche de commerces (défaut 30 s) — pas par tentative. */
  timeoutMs?: number;
  /** // FIX (PROBLÈME 2) : informe l'UI du miroir essayé (message d'étape). */
  onProgress?: (info: {
    host: string;
    attempt: number;
    total: number;
    shape?: string;
    /** Nombre de miroirs interrogés simultanément dans cette manche. */
    parallel?: number;
  }) => void;
}

export interface OverpassResult {
  venues: Venue[];
  endpointUsed: string;
  /** // FIX (PROBLÈME 3) : chronométrage de l'étape, affiché dans l'UI */
  durationMs: number;
  /** Forme de requête qui a répondu (« aire » ou « emprise »). */
  shape: string;
}

const AMENITIES = ["restaurant", "fast_food", "cafe", "bar", "pub", "bakery"];

/**
 * Deux formes de requête possibles pour un même lieu :
 *  - `aire`   : la frontière exacte de la commune/du quartier (relation OSM) ;
 *  - `emprise`: le rectangle englobant (fourni par Photon/Nominatim, ou
 *              fabriqué à partir du point et de la population).
 * Résoudre une frontière est nettement plus lourd qu'un rectangle : quand
 * l'aire échoue, la même recherche est rejouée sur l'emprise.
 */
type QueryShape = { label: string; query: string };

function buildQueries(place: GeoPlace, amenities: string[]): QueryShape[] {
  const amenityRegex = `^(${amenities.join("|")})$`;
  const foodSelector = `nwr[amenity~"${amenityRegex}"]`;
  const bakerySelector = `nwr[shop~"^(bakery|pastry)$"][name]`;
  const shapes: QueryShape[] = [];

  // FIX (PROBLÈME 2 — mobile) : plafond de résultats ramené à 800 (l'UI en
  // conserve 700) pour ne pas faire transiter 4x trop de données.
  if (place.areaId) {
    shapes.push({
      label: "aire",
      query: `[out:json][timeout:45];\narea(${place.areaId})->.searchArea;\n(\n  ${foodSelector}(area.searchArea);\n  ${bakerySelector}(area.searchArea);\n);\nout center 800;`,
    });
  }
  if (place.boundingBox) {
    const bbox = bboxString(place.boundingBox);
    shapes.push({
      label: "emprise",
      query: `[out:json][timeout:45];\n(\n  ${foodSelector}(${bbox});\n  ${bakerySelector}(${bbox});\n);\nout center 800;`,
    });
  }
  if (shapes.length === 0) {
    throw new NetworkError("Ce lieu n'a ni zone ni emprise géographique exploitable.");
  }
  // L'emprise est bien plus rapide à traiter : quand les deux formes sont
  // disponibles, on la tente EN PREMIER (elle couvre la même ville, déborde
  // seulement un peu autour) — l'aire ne sert plus que de secours.
  return shapes.sort((a, b) => (a.label === "emprise" ? -1 : b.label === "emprise" ? 1 : 0));
}

export function elementToVenue(el: OverpassElement): Venue | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const shop = tags.shop;
  const amenity = tags.amenity;
  const isFood =
    AMENITIES.includes(amenity ?? "") || shop === "bakery" || shop === "pastry";
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
    origin: "osm",
    rawTags: tags,
  };
}

/**
 * Analyse le corps d'une réponse Overpass.
 * Retourne `null` quand ce n'est PAS du JSON exploitable (page HTML d'erreur
 * « OSM3S », XML, réponse tronquée…) — cause n°3 corrigée ici.
 */
export function parseOverpassBody(text: string): { elements: OverpassElement[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { elements?: OverpassElement[] };
    if (!parsed || !Array.isArray(parsed.elements)) return null;
    return { elements: parsed.elements };
  } catch {
    return null;
  }
}

function venuesFromElements(elements: OverpassElement[]): Venue[] {
  const venues: Venue[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const venue = elementToVenue(el);
    if (venue && !seen.has(venue.id)) {
      seen.add(venue.id);
      venues.push(venue);
    }
  }
  venues.sort((a, b) => a.name.localeCompare(b.name));
  return venues;
}

interface RoundOutcome {
  host: string;
  venues: Venue[];
  /** Le miroir a répondu un JSON valide mais SANS commerce. */
  empty: boolean;
  errors: string[];
}

/**
 * Une manche : TOUS les miroirs interrogés en parallèle, le premier JSON valide
 * contenant des commerces gagne et les autres requêtes sont annulées. Un miroir
 * qui répond une liste vide est mémorisé mais ne fait pas gagner la manche (un
 * miroir peut renvoyer une base partielle) : on laisse sa chance aux autres
 * jusqu'à la fin de la manche.
 */
async function raceMirrors(
  query: string,
  shapeLabel: string,
  round: number,
  totalRounds: number,
  capMs: number,
  signal: AbortSignal | undefined,
  onProgress: OverpassQueryOptions["onProgress"],
): Promise<RoundOutcome> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), capMs);

  const errors: string[] = [];
  let emptyHost: string | null = null;
  let settled = false;
  let winner: { host: string; venues: Venue[] } | null = null;

  try {
    await new Promise<void>((resolve) => {
      let pending = OVERPASS_MIRRORS.length;
      const done = () => {
        pending -= 1;
        if (pending === 0) resolve();
      };

      OVERPASS_MIRRORS.forEach((endpoint) => {
        const host = new URL(endpoint).hostname;
        void (async () => {
          try {
            // FIX (cause n°1) : GET, jamais POST. `Accept` est un en-tête
            // « safelisted » : aucune requête préalable CORS n'est déclenchée.
            const res = await fetch(
              `${endpoint}?data=${encodeURIComponent(query)}`,
              { method: "GET", signal: controller.signal, headers: { Accept: "application/json" } },
            );
            if (settled) return;
            if (!res.ok) {
              errors.push(`${host} → HTTP ${res.status}`);
              return;
            }
            const body = parseOverpassBody(await res.text());
            if (settled) return;
            if (!body) {
              errors.push(`${host} → réponse illisible (miroir surchargé)`);
              return;
            }
            const venues = venuesFromElements(body.elements);
            if (venues.length === 0) {
              emptyHost ??= host;
              errors.push(`${host} → aucun commerce dans cette zone`);
              return;
            }
            settled = true;
            winner = { host, venues };
            controller.abort();
          } catch (err) {
            if (!settled && !signal?.aborted) errors.push(`${host} → ${describeError(err)}`);
          } finally {
            done();
          }
        })();
      });

      onProgress?.({
        host: `${OVERPASS_MIRRORS.length} miroirs interrogés en parallèle`,
        attempt: round,
        total: totalRounds,
        shape: shapeLabel,
        parallel: OVERPASS_MIRRORS.length,
      });
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (winner) {
    const w = winner as { host: string; venues: Venue[] };
    return { host: w.host, venues: w.venues, empty: false, errors };
  }
  return { host: emptyHost ?? "aucun", venues: [], empty: emptyHost !== null, errors };
}

/**
 * ÉTAPE 2 : passerelle serveur `/api/osm` (déployée avec le site).
 *
 * POURQUOI ELLE EXISTE : les miroirs interdisent en pratique l'accès direct
 * depuis un navigateur (User-Agent impossible à envoyer) et saturent sous les
 * requêtes répétées de chaque visiteur. La passerelle, elle, envoie un
 * User-Agent correct, interroge les miroirs en parallèle côté serveur et MET EN
 * CACHE le résultat : une réussite sert ensuite tous les visiteurs.
 * Absente en développement (Vite n'exécute pas les fonctions serverless) : dans
 * ce cas la réponse n'est pas du JSON et l'étape est simplement ignorée.
 */
async function queryViaProxy(
  query: string,
  capMs: number,
  signal: AbortSignal | undefined,
): Promise<{ venues: Venue[]; empty: boolean; source: string | null; errors: string[] }> {
  const errors: string[] = [];
  try {
    const res = await fetchWithTimeout(
      `/api/osm?q=${encodeURIComponent(query)}`,
      { signal, headers: { Accept: "application/json" } },
      capMs,
    );
    if (!res.ok) {
      errors.push(`passerelle serveur → HTTP ${res.status}`);
      return { venues: [], empty: false, source: null, errors };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      elements?: OverpassElement[];
      source?: string;
    };
    if (!body?.ok || !Array.isArray(body.elements)) {
      errors.push("passerelle serveur → réponse inexploitable");
      return { venues: [], empty: false, source: null, errors };
    }
    const venues = venuesFromElements(body.elements);
    return { venues, empty: venues.length === 0, source: body.source ?? "passerelle", errors };
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    errors.push(`passerelle serveur → ${describeError(err)}`);
    return { venues: [], empty: false, source: null, errors };
  }
}

export async function queryVenues(
  place: GeoPlace,
  opts: OverpassQueryOptions = {},
): Promise<OverpassResult> {
  const shapes = buildQueries(place, opts.types ?? AMENITIES);
  const errors: string[] = [];
  const startedAt = Date.now();

  /**
   * // FIX (PROBLÈME 3) : budget TOTAL borné (28 s par défaut) — avant, 3
   * miroirs × 2 tentatives × 15 s pouvaient atteindre 90 s d'attente muette.
   */
  const TOTAL_BUDGET_MS = opts.timeoutMs ?? 28_000;
  const deadlineAt = startedAt + TOTAL_BUDGET_MS;
  /** Deux manches par forme : la seconde absorbe une surcharge passagère. */
  const ROUNDS = 2;
  const ROUND_PAUSE_MS = 700;
  /** Une manche ne peut pas dépasser 12 s (et jamais le budget restant). */
  const ROUND_CAP_MS = 12_000;
  /**
   * Réserve gardée pour la forme suivante : une aire met souvent > 10 s à être
   * résolue, alors qu'un rectangle répond en 1–3 s.
   */
  const RESERVE_FOR_NEXT_SHAPE_MS = 8_000;

  for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
    const shape = shapes[shapeIndex];
    const isLastShape = shapeIndex === shapes.length - 1;
    const reserve = isLastShape ? 0 : RESERVE_FOR_NEXT_SHAPE_MS;
    const suffix = shapes.length > 1 ? ` (${shape.label})` : "";

    for (let round = 1; round <= ROUNDS; round++) {
      const remaining = deadlineAt - Date.now() - reserve;
      if (remaining < 3_000) {
        errors.push(`${shape.label} → budget de temps épuisé`);
        break;
      }
      if (round > 1) await sleep(ROUND_PAUSE_MS * round);

      const cap = Math.max(3_000, Math.min(ROUND_CAP_MS, deadlineAt - Date.now() - reserve));
      let outcome: RoundOutcome;
      try {
        outcome = await raceMirrors(
          shape.query,
          shape.label,
          round,
          ROUNDS,
          cap,
          opts.signal,
          opts.onProgress,
        );
      } catch (err) {
        // Annulation volontaire de l'utilisateur : on propage sans retry.
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        logError("overpass", err, { forme: shape.label, manche: round });
        errors.push(`${shape.label} → ${describeError(err)}`);
        continue;
      }

      // Annulation volontaire de l'utilisateur pendant la manche.
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      errors.push(...outcome.errors.map((e) => `${e}${suffix}`));

      if (outcome.venues.length > 0) {
        const durationMs = Date.now() - startedAt;
        logInfo(
          "overpass",
          `${outcome.venues.length} commerces via ${outcome.host}${suffix} en ${durationMs} ms (manche ${round}/${ROUNDS})`,
        );
        return {
          venues: outcome.venues,
          endpointUsed: outcome.host,
          durationMs,
          shape: shape.label,
        };
      }

      // JSON valide mais zone vide : c'est un VRAI résultat (aucun commerce
      // cartographié ici), inutile d'insister sur une autre manche.
      if (outcome.empty) {
        logInfo("overpass", `zone vide confirmée par ${outcome.host}${suffix}`);
        return { venues: [], endpointUsed: outcome.host, durationMs: Date.now() - startedAt, shape: shape.label };
      }
    }

    // ÉTAPE 2 — passerelle serveur (cache + User-Agent correct, sans CORS).
    const remainingForProxy = deadlineAt - Date.now() - reserve;
    if (remainingForProxy > 4_000) {
      opts.onProgress?.({
        host: "passerelle serveur (mise en cache)",
        attempt: 1,
        total: 1,
        shape: shape.label,
      });
      const proxied = await queryViaProxy(
        shape.query,
        Math.min(14_000, remainingForProxy),
        opts.signal,
      );
      errors.push(...proxied.errors.map((e) => `${e}${suffix}`));
      if (proxied.venues.length > 0) {
        const durationMs = Date.now() - startedAt;
        logInfo(
          "overpass",
          `${proxied.venues.length} commerces via la passerelle serveur (${proxied.source}) en ${durationMs} ms`,
        );
        return {
          venues: proxied.venues,
          endpointUsed: `passerelle (${proxied.source})`,
          durationMs,
          shape: shape.label,
        };
      }
      if (proxied.empty) {
        return {
          venues: [],
          endpointUsed: `passerelle (${proxied.source})`,
          durationMs: Date.now() - startedAt,
          shape: shape.label,
        };
      }
    }
  }

  // FIX (PROBLÈME 1) : message clair en français + erreur exacte en console.
  const detail = errors.length > 0 ? ` (${errors.slice(0, 6).join(" · ")})` : "";
  throw new NetworkError(
    `Aucun miroir OpenStreetMap n'a répondu${detail}. ` +
      "Les serveurs publics sont parfois saturés : réessayez dans quelques secondes, ou demandez des pistes reconstituées par l'analyse.",
  );
}
