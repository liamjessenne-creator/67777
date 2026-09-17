/**
 * Recherche de villes (géocodage) — trois fournisseurs indépendants + cache local.
 *
 * POURQUOI CE CHANGEMENT (l'appelait « nominatim.ts » et ne jurait que par
 * OpenStreetMap, via un seul service) :
 *
 *  1. **Nominatim ne renvoie AUCUN en-tête CORS.** Mesuré deux fois, y compris
 *     avec un `Origin` et un `Referer` : la réponse contient
 *     `Vary: accept-language, Accept-Encoding` mais pas
 *     `Access-Control-Allow-Origin`. Dans un navigateur standard (donc sur
 *     téléphone), `fetch` rejette la réponse : la recherche « ne faisait rien »
 *     jusqu'à ce que le repli prenne le relais — un aller-retour réseau perdu à
 *     chaque frappe, et le message « les deux services sont injoignables » quand
 *     le repli tombait aussi.
 *  2. **Photon (komoot) répond plus vite et plus complètement** : 0,14–0,17 s
 *     mesurés contre 0,15–0,50 s pour Nominatim, en-tête
 *     `Access-Control-Allow-Origin: *` (donc utilisable depuis un vrai
 *     navigateur), et il gère les ARRONDISSEMENTS (« Lyon 3e » → « 3e
 *     Arrondissement », type `district`, relation OSM) avec une **emprise**
 *     (`extent`) directement exploitable par Overpass.
 *  3. **Dépendre d'un seul service public est le vrai point faible.** On garde
 *     donc trois échelons indépendants : Photon → Nominatim → Open-Meteo
 *     (base GeoNames, donc PAS OpenStreetMap du tout : 0,11–0,13 s mesurés,
 *     lui aussi en CORS ouvert).
 *  4. **Chaque résultat est désormais scannable** : quand un fournisseur ne
 *     donne pas d'emprise (Open-Meteo, ou une entité OSM sans bbox), on en
 *     fabrique une autour du point, dimensionnée à la population — sinon
 *     Overpass répondait « ce lieu n'a ni zone ni emprise exploitable ».
 *  5. **Cache local** (30 jours, 60 requêtes) : retaper une ville déjà cherchée
 *     est instantané, sans réseau — le meilleur gain sur mobile et pour les
 *     services publics, qui limitent volontairement les appels.
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
  /** Fournisseur qui a produit ce résultat (journalisation, transparence). */
  source?: GeoProvider;
}

export type GeoProvider = "photon" | "nominatim" | "open-meteo" | "cache";

import { NetworkError, describeError, fetchWithRetry, logError, logInfo } from "./net";

/* ------------------------------------------------------------------ */
/* Mise en cache locale                                                */
/* ------------------------------------------------------------------ */

/**
 * La VERSION fait partie de la clé : changer la façon de nommer les lieux
 * (préfixe de commune, libellé complet) doit invalider les anciennes entrées,
 * sinon un utilisateur garde 30 jours des libellés produits par l'ancien code.
 */
const CACHE_KEY = "geolead.geocode.v2";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 60;

interface CacheEntry {
  at: number;
  places: GeoPlace[];
}

function cacheRead(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Résultat déjà connu pour cette requête (aucun appel réseau). */
export function cachedCitySearch(query: string): GeoPlace[] | null {
  if (query.trim().length < 3) return null;
  const entry = cacheRead()[cacheKey(query)];
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.places.map((p) => ({ ...p, source: "cache" as GeoProvider }));
}

function cacheWrite(query: string, places: GeoPlace[]): void {
  if (places.length === 0) return;
  try {
    const all = cacheRead();
    all[cacheKey(query)] = { at: Date.now(), places };
    const entries = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Quota / mode privé : le cache est un confort, pas une dépendance.
  }
}

/* ------------------------------------------------------------------ */
/* Utilitaires communs                                                 */
/* ------------------------------------------------------------------ */

/**
 * Rayon (km) déduit de la population, pour les fournisseurs qui ne donnent pas
 * d'emprise. Volontairement généreux : mieux vaut scanner un peu large que
 * rater des commerces du quartier.
 */
function radiusKmForPopulation(population: number | null): number {
  if (!population || population < 5_000) return 1.5;
  if (population < 20_000) return 2.5;
  if (population < 100_000) return 4;
  if (population < 500_000) return 7;
  return 11;
}

/** Emprise [south, north, west, east] autour d'un point. */
function boxAround(lat: number, lon: number, km: number): [number, number, number, number] {
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lat + dLat, lon - dLon, lon + dLon];
}

/** OSM relation → identifiant d'aire Overpass (3600000000 + id). */
function areaIdFor(osmType: string, osmId: number): number | null {
  return osmType === "relation" && osmId ? 3_600_000_000 + osmId : null;
}

function dedupe(places: GeoPlace[]): GeoPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.osmType}/${p.osmId}|${p.displayName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* ------------------------------------------------------------------ */
/* 1. Photon (komoot) — fournisseur PRINCIPAL                          */
/* ------------------------------------------------------------------ */

interface PhotonFeature {
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_type?: string;
    osm_id?: number;
    type?: string;
    postcode?: string;
    /** [minLon, maxLat, maxLon, minLat] */
    extent?: [number, number, number, number];
  };
  geometry?: { coordinates?: number[] };
}

const PHOTON_BASE = "https://photon.komoot.io/api";

/**
 * Types Photon conservés : ce sont des LIEUX. Sans ce filtre, « Lyon 3e »
 * remontait des « house » (numéros de rue) qui noyaient le résultat utile.
 */
const PLACE_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "borough",
  "municipality",
  "district",
  "suburb",
  "quarter",
  "neighbourhood",
  "locality",
  "county",
  "state",
  "region",
  "country",
]);

function photonToPlace(feature: PhotonFeature): GeoPlace | null {
  const p = feature.properties;
  if (!p?.name || !Array.isArray(feature.geometry?.coordinates)) return null;
  const [lon, lat] = feature.geometry!.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const type = (p.type ?? "").toLowerCase();
  if (!PLACE_TYPES.has(type)) return null;

  const osmType =
    p.osm_type === "R" ? "relation" : p.osm_type === "W" ? "way" : p.osm_type === "N" ? "node" : "relation";
  const osmId = p.osm_id ?? 0;
  // `name` d'abord : pour « Lyon 3e », Photon nomme l'entité
  // « 3e Arrondissement » alors que `city` vaut « Lyon » — prendre `city`
  // aurait fait disparaître l'arrondissement demandé.
  // Pour les divisions d'une ville, on préfixe la commune : « 3e Arrondissement »
  // seul ne dit rien une fois le champ rempli, « Lyon 3e Arrondissement » si.
  const isDivision = ["district", "suburb", "quarter", "neighbourhood"].includes(type);
  const shortName =
    isDivision && p.city && !normalizeText(p.name).includes(normalizeText(p.city))
      ? `${p.city} ${p.name}`
      : p.name;
  // Libellé complet sans redite : « Lyon 3e Arrondissement, Auvergne-Rhône-Alpes,
  // France » plutôt que « 3e Arrondissement, Lyon, Auvergne-Rhône-Alpes, France ».
  const place = [p.city, p.state, p.country]
    .filter((part): part is string => Boolean(part) && !normalizeText(shortName).includes(normalizeText(part!)))
    .join(", ");
  const ext = p.extent;
  const boundingBox: [number, number, number, number] = ext
    ? [ext[3], ext[1], ext[0], ext[2]] // extent [minLon,maxLat,maxLon,minLat] → [S,N,W,E]
    : boxAround(lat, lon, radiusKmForPopulation(null));

  return {
    osmId,
    osmType,
    displayName: `${shortName}${place ? `, ${place}` : ""}`,
    shortName,
    country: p.country ?? null,
    lat,
    lon,
    boundingBox,
    areaId: areaIdFor(osmType, osmId),
    isLocality: ["city", "town", "village", "borough", "municipality", "locality"].includes(type),
    source: "photon",
  };
}

export async function searchPhoton(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = new URL(PHOTON_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "fr");

  // Timeout 8 s (le service répond en ~0,15 s quand il va bien) + 2 essais.
  const res = await fetchWithRetry(url.toString(), {
    timeoutMs: 8_000,
    attempts: 2,
    baseDelayMs: 400,
    label: "Photon",
    signal,
  });
  if (!res.ok) {
    throw new NetworkError(`Recherche de ville indisponible (Photon : HTTP ${res.status}).`, res.status);
  }
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const places = (json.features ?? [])
    .map((f) => photonToPlace(f))
    .filter((p): p is GeoPlace => p !== null);

  /*
   * Photon classe déjà par pertinence (pour « Lyon 3e » l'arrondissement sort
   * en premier, pour « Villeurbanne » la commune sort en premier) : on NE
   * réordonne pas. On remonte seulement en tête les noms qui correspondent
   * exactement à la saisie, au cas où une rue ou un lieu-dit passerait devant.
   */
  const wanted = normalizeText(query.trim());
  const unique = dedupe(places);
  const exact = unique.filter((p) => normalizeText(p.shortName) === wanted);
  const rest = unique.filter((p) => !exact.includes(p));
  return [...exact, ...rest];
}

/* ------------------------------------------------------------------ */
/* 2. Nominatim (OpenStreetMap) — repli PRÉCIS                         */
/* ------------------------------------------------------------------ */

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

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * Conservé pour sa précision (libellés officiels, `boundingbox` exacte), mais
 * en SECOND : il n'envoie pas d'en-tête CORS, donc un navigateur standard
 * rejette sa réponse. Il reste utile en application de bureau (Electron), où
 * CORS n'est pas appliqué.
 */
export async function searchNominatim(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");

  const res = await fetchWithRetry(url.toString(), {
    timeoutMs: 8_000,
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
    const boundingBox: [number, number, number, number] =
      bb && bb.length === 4 && bb.every((v) => Number.isFinite(v))
        ? [bb[0], bb[1], bb[2], bb[3]]
        : boxAround(lat, lon, radiusKmForPopulation(null));
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
      areaId: areaIdFor(osmType, osmId),
      isLocality:
        normalizeText(item.address?.city ?? item.address?.town ?? item.address?.village ?? "") ===
        normalizeText(shortName),
      source: "nominatim" as GeoProvider,
    };
  });

  return dedupe(places).sort((a, b) => Number(b.isLocality) - Number(a.isLocality));
}

/* ------------------------------------------------------------------ */
/* 3. Open-Meteo (base GeoNames) — repli INDÉPENDANT d'OpenStreetMap   */
/* ------------------------------------------------------------------ */

interface OpenMeteoResult {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  population?: number;
  feature_code?: string;
}

export async function searchOpenMeteo(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "fr");
  url.searchParams.set("format", "json");

  const res = await fetchWithRetry(url.toString(), {
    timeoutMs: 8_000,
    attempts: 2,
    baseDelayMs: 400,
    label: "Open-Meteo",
    signal,
  });
  if (!res.ok) {
    throw new NetworkError(`Recherche de ville indisponible (Open-Meteo : HTTP ${res.status}).`, res.status);
  }
  const json = (await res.json()) as { results?: OpenMeteoResult[] };
  const results = json.results ?? [];

  const places = results
    .filter((r) => r.name && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => {
      const lat = r.latitude as number;
      const lon = r.longitude as number;
      const region = [r.admin1, r.country].filter(Boolean).join(", ");
      return {
        // GeoNames n'a pas d'identifiant OSM : on préfixe pour ne jamais le
        // confondre avec une entité OSM dans les journaux.
        osmId: r.id ?? 0,
        osmType: "geonames",
        displayName: `${r.name}${region ? `, ${region}` : ""}`,
        shortName: r.name as string,
        country: r.country ?? null,
        lat,
        lon,
        // Pas d'emprise en base : on en fabrique une selon la population, sinon
        // Overpass ne pourrait rien scanner.
        boundingBox: boxAround(lat, lon, radiusKmForPopulation(r.population ?? null)),
        areaId: null,
        isLocality: true,
        source: "open-meteo" as GeoProvider,
      };
    });

  return dedupe(places);
}

/* ------------------------------------------------------------------ */
/* Chaîne de fournisseurs                                              */
/* ------------------------------------------------------------------ */

const PROVIDERS: { name: GeoProvider; run: (q: string, s?: AbortSignal) => Promise<GeoPlace[]> }[] = [
  { name: "photon", run: searchPhoton },
  { name: "nominatim", run: searchNominatim },
  { name: "open-meteo", run: searchOpenMeteo },
];

/**
 * Recherche une ville : cache local d'abord, puis les fournisseurs dans
 * l'ordre. Le premier qui répond gagne ; les erreurs sont journalisées une par
 * une et un message français clair n'est levé que si TOUS échouent.
 */
export async function searchCity(query: string, signal?: AbortSignal): Promise<GeoPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const cached = cachedCitySearch(trimmed);
  if (cached) {
    logInfo("geocodage", `${cached.length} résultat(s) en cache pour « ${trimmed} »`);
    return cached;
  }

  const failures: string[] = [];
  for (const provider of PROVIDERS) {
    const startedAt = Date.now();
    try {
      const places = await provider.run(trimmed, signal);
      if (places.length > 0) {
        logInfo(
          "geocodage",
          `${places.length} résultat(s) via ${provider.name} en ${Date.now() - startedAt} ms`,
          { requete: trimmed },
        );
        cacheWrite(trimmed, places);
        return places;
      }
      // Réponse vide : ce n'est pas une erreur, on tente le suivant.
      logInfo("geocodage", `aucun résultat via ${provider.name} pour « ${trimmed} »`);
    } catch (err) {
      // Annulation volontaire (frappe suivante) : on ne bascule pas de fournisseur.
      if (signal?.aborted) throw err;
      failures.push(`${provider.name} → ${describeError(err)}`);
      logError("geocodage", err, { fournisseur: provider.name, requete: trimmed });
    }
  }

  if (failures.length === PROVIDERS.length) {
    throw new NetworkError(
      "Recherche de ville impossible : les trois services de géocodage sont injoignables " +
        `(${failures.join(" · ")}). Vérifiez votre connexion puis réessayez.`,
    );
  }
  return [];
}

/** Overpass bbox string "south,west,north,east" from a bounding box. */
export function bboxString(bb: [number, number, number, number]): string {
  const [south, north, west, east] = bb;
  return `${south},${west},${north},${east}`;
}
