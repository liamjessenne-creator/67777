/**
 * Aperçus visuels des sites (vignettes de la fiche prospect et du tableau).
 *
 * POURQUOI CE MODULE — l'aperçu « marchait moyen » pour trois raisons précises,
 * mesurées sur de vrais sites :
 *
 *  1. Il utilisait l'image de partage du site (`embed=image.url`) : pour
 *     bigfernand.com l'og:image fait **96×96 px** (étirée dans une carte de
 *     344×172 : floue), pour 100percentcrousti.com le service répond
 *     `{"status":"fail"}` en 20 octets (image cassée) et pour
 *     brasseriedelavillette.fr c'est un **SVG** (donc un logo, pas la page).
 *     → On demande désormais un CLOQUÉ RÉEL de la page, en JPEG qualité 72 :
 *       44 à 210 Ko selon le site, net et léger.
 *  2. Aucun cache : chaque survol relançait la requête (≈1 à 6 s la première fois).
 *     → Mémoire + `localStorage` (le verdict « déjà chargé » est donc instantané
 *       après un rechargement, et le nombre d'appels au service public reste bas).
 *  3. Les requêtes identiques n'étaient pas partagées : la même enseigne apparaît
 *     souvent plusieurs fois dans la table (plusieurs établissements d'une chaîne).
 *     → Une seule requête par domaine, préchauffée dès le survol du lien.
 *
 * Le service (Microlink) est public et sans clé ; le cache protège aussi son
 * quota. Aucun échec silencieux : un site injoignable est mémorisé « ko » et la
 * carte affiche un repli propre au lieu d'un cadre blanc.
 */

const LS_KEY = "geolead.thumbnails.v1";
/** Nombre d'aperçus mémorisés (au-delà, les plus anciens sont oubliés). */
const LS_MAX = 120;

export type ThumbStatus = "ok" | "ko";

interface Entry {
  status: ThumbStatus;
  at: number;
}

const MEM = new Map<string, Entry>();
/** Sites dont un chargement est en cours (évite les requêtes en double). */
const INFLIGHT = new Set<string>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [site, value] of Object.entries(parsed as Record<string, Entry>)) {
      if (value && (value.status === "ok" || value.status === "ko")) {
        MEM.set(site, { status: value.status, at: value.at ?? 0 });
      }
    }
  } catch {
    // localStorage indisponible (mode privé, quota) : le cache mémoire suffit.
  }
}

function persist(): void {
  try {
    if (MEM.size > LS_MAX) {
      const sorted = [...MEM.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, LS_MAX);
      MEM.clear();
      for (const [site, entry] of sorted) MEM.set(site, entry);
    }
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(MEM)));
  } catch {
    // Quota atteint : on garde le cache mémoire, rien d'autre à faire.
  }
}

/** Verdict déjà connu pour ce site, sans aucun appel réseau. */
export function thumbStatus(site: string): ThumbStatus | undefined {
  hydrate();
  return MEM.get(site)?.status;
}

/** Mémorise le résultat d'un chargement (succès ou échec). */
export function markThumb(site: string, status: ThumbStatus): void {
  hydrate();
  MEM.set(site, { status, at: Date.now() });
  INFLIGHT.delete(site);
  persist();
}

/**
 * Cloqué réel de la page, en JPEG léger.
 * `waitUntil=domcontentloaded` évite d'attendre les publicités et les cartes,
 * ce qui divise le temps de génération sans perdre la mise en page.
 */
export function shotUrl(site: string, width = 1280, height = 720): string {
  const enc = encodeURIComponent(site);
  return (
    `https://api.microlink.io/?url=${enc}` +
    "&screenshot=true&meta=false&embed=screenshot.url&waitUntil=domcontentloaded" +
    "&screenshot.type=jpeg&screenshot.quality=72" +
    `&viewport.width=${width}&viewport.height=${height}`
  );
}

/**
 * Précharge l'aperçu d'un site (au survol / sur focus) : quand la carte s'ouvre,
 * l'image est déjà en route — ou déjà en cache.
 */
export function preloadShot(site: string): void {
  if (!site || typeof Image === "undefined") return;
  hydrate();
  if (INFLIGHT.has(site) || MEM.get(site)?.status === "ok") return;
  INFLIGHT.add(site);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => markThumb(site, "ok");
  img.onerror = () => markThumb(site, "ko");
  img.src = shotUrl(site);
}

/** Domaine lisible (« www. » retiré) — repli d'affichage de la carte. */
export function siteHost(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return site.replace(/^https?:\/\//, "").split("/")[0];
  }
}
