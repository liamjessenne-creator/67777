/**
 * Passerelle cartographique — fonction serverless Vercel (`/api/osm`).
 *
 * POURQUOI CE FICHIER : les miroirs Overpass publics sont des services
 * bénévoles. Interrogés depuis le NAVIGATEUR, ils échouent souvent pour trois
 * raisons sur lesquelles l'application n'a aucune prise :
 *   1. ils saturent (504) et le navigateur les abandonne avec un simple
 *      « Failed to fetch », sans explication ;
 *   2. leur politique d'usage EXIGE un `User-Agent` identifiant l'application —
 *      en-tête qu'un navigateur ne peut PAS envoyer (il est interdit par la spec
 *      fetch) ;
 *   3. chaque visiteur repaie la même requête coûteuse, ce qui aggrave la
 *      saturation et fait tomber le service pour tout le monde.
 *
 * Cette fonction règle les trois points côté serveur : elle envoie un
 * User-Agent correct, interroge tous les miroirs EN PARALLÈLE, élague les
 * données inutiles (charge utile ~2x plus légère pour le mobile) et MET EN
 * CACHE le résultat. Une seule requête réussie sert ensuite tous les visiteurs
 * pendant 15 minutes (cache mémoire de l'instance + cache CDN Vercel).
 *
 * USAGE : GET /api/osm?q=<requête Overpass encodée>
 *   → 200 { ok: true, elements: [...], source: "overpass-api.de", cached, ms }
 *   → 4xx/5xx { ok: false, error: "message en français", detail? }
 */

export const config = { runtime: "edge" };

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Politique d'usage Overpass : un User-Agent explicite est requis. */
const USER_AGENT = "GeoLeadFinder/1.0 (outil de prospection locale; contact: support@geolead-finder.app)";
/** Requête acceptée au maximum : une requête Overpass légitime tient largement. */
const MAX_QUERY_LENGTH = 2_000;
/** Plafond par miroir. */
const MIRROR_TIMEOUT_MS = 14_000;
/** Durée de mise en cache (le mobilier urbain ne change pas en 15 minutes). */
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_ENTRIES = 60;

/**
 * Balises réellement utilisées par l'application. Overpass renvoie l'intégralité
 * des tags (parfois 20 par commerce) : on élague côté serveur, la charge utile
 * transmise au navigateur — donc au téléphone — est nettement plus légère.
 */
const TAG_WHITELIST = new Set([
  "name",
  "amenity",
  "shop",
  "cuisine",
  "addr:housenumber",
  "addr:street",
  "addr:postcode",
  "addr:city",
  "phone",
  "contact:phone",
  "contact:mobile",
  "website",
  "contact:website",
  "contact:facebook",
  "contact:instagram",
  "opening_hours",
]);

interface RawElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface CacheEntry {
  at: number;
  elements: RawElement[];
  source: string;
}

const cache = new Map<string, CacheEntry>();

function reply(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function failure(message: string, detail?: string, status = 502): Response {
  return reply({ ok: false, error: message, detail }, status);
}

/** Ne garde que les commerces utiles, avec leurs seules balises exploitées. */
function prune(elements: RawElement[]): RawElement[] {
  const out: RawElement[] = [];
  for (const el of elements) {
    const tags = el.tags;
    if (!tags || !tags.name) continue;
    const trimmed: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
      if (TAG_WHITELIST.has(key)) trimmed[key] = value;
    }
    out.push({
      type: el.type,
      id: el.id,
      ...(el.lat != null ? { lat: el.lat } : {}),
      ...(el.lon != null ? { lon: el.lon } : {}),
      ...(el.center ? { center: el.center } : {}),
      tags: trimmed,
    });
  }
  return out;
}

/**
 * Interroge TOUS les miroirs en parallèle : le premier JSON valide contenant des
 * commerces gagne, les autres requêtes sont annulées. Une réponse illisible (page
 * HTML d'erreur renvoyée avec un code 200) est rejetée au lieu d'être propagée.
 */
async function fetchMirrors(query: string): Promise<{ elements: RawElement[]; source: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
  let winner: { elements: RawElement[]; source: string } | null = null;
  const errors: string[] = [];

  try {
    await new Promise<void>((resolve) => {
      let pending = MIRRORS.length;
      const done = () => {
        pending -= 1;
        if (pending === 0) resolve();
      };

      MIRRORS.forEach((endpoint) => {
        const host = new URL(endpoint).hostname;
        void (async () => {
          try {
            const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
              method: "GET",
              headers: { Accept: "application/json", "User-Agent": USER_AGENT },
              signal: controller.signal,
            });
            if (winner) return;
            if (!res.ok) {
              errors.push(`${host} → HTTP ${res.status}`);
              return;
            }
            const text = (await res.text()).trim();
            if (winner) return;
            if (!text.startsWith("{")) {
              errors.push(`${host} → réponse illisible`);
              return;
            }
            const parsed = JSON.parse(text) as { elements?: RawElement[] };
            const elements = parsed?.elements;
            if (!Array.isArray(elements)) {
              errors.push(`${host} → format inattendu`);
              return;
            }
            // Une liste vide n'est acceptée que si personne d'autre ne répond :
            // un miroir peut renvoyer une base partielle.
            if (elements.length === 0) {
              errors.push(`${host} → aucun commerce`);
              return;
            }
            winner = { elements, source: host };
            controller.abort();
          } catch (err) {
            if (!winner) {
              const name = err instanceof Error ? err.name : "erreur";
              errors.push(`${host} → ${name === "AbortError" ? "délai dépassé" : name}`);
            }
          } finally {
            done();
          }
        })();
      });
    });
  } finally {
    clearTimeout(timer);
  }

  if (winner) return winner;
  throw new Error(errors.slice(0, 6).join(" · ") || "aucun miroir n'a répondu");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  }
  if (req.method !== "GET") return failure("Méthode non autorisée.", undefined, 405);

  const query = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!query) return failure("Requête manquante : le paramètre `q` est obligatoire.", undefined, 400);
  if (query.length > MAX_QUERY_LENGTH) {
    return failure("Requête trop longue : réduisez la zone recherchée.", undefined, 413);
  }
  // Garde-fou : cet endpoint ne relaie QUE des lectures Overpass.
  if (!query.startsWith("[") || !/out\b/i.test(query)) {
    return failure(
      "Requête refusée : seules les lectures OpenStreetMap (requêtes Overpass) sont acceptées.",
      undefined,
      400,
    );
  }

  const key = query.replace(/\s+/g, " ");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return reply(
      { ok: true, elements: hit.elements, source: hit.source, cached: true, ms: 0 },
      200,
      { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
    );
  }

  const startedAt = Date.now();
  try {
    const { elements, source } = await fetchMirrors(query);
    const pruned = prune(elements);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // Éviction du plus ancien (la carte est petite : un simple parcours suffit).
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(key, { at: Date.now(), elements: pruned, source });
    console.log(`[osm] ${pruned.length} commerces via ${source} en ${Date.now() - startedAt} ms`);
    return reply(
      { ok: true, elements: pruned, source, cached: false, ms: Date.now() - startedAt },
      200,
      { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[osm] échec : ${detail}`);
    return failure(
      "Aucun serveur OpenStreetMap n'a répondu. Les miroirs publics sont saturés : réessayez dans quelques secondes.",
      detail,
      503,
    );
  }
}
