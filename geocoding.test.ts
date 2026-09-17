/**
 * Tests du géocodage multi-fournisseurs.
 *
 * Ce qui est vérifié ici, et pourquoi :
 *  - Photon (fournisseur PRINCIPAL) produit un résultat SCANNABLE : emprise
 *    géographique présente, identifiant d'aire Overpass pour les relations.
 *  - Les entités non géographiques (numéros de rue « house ») sont écartées :
 *    sans ce filtre, « Lyon 3e » remontait surtout des adresses.
 *  - Open-Meteo (base GeoNames, pas d'emprise) en fabrique une : sans elle,
 *    Overpass levait « ce lieu n'a ni zone ni emprise géographique exploitable ».
 *  - La chaîne de repli : si Photon échoue, le suivant prend la main.
 *  - Le cache local évite les appels réseau répétés.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bboxString,
  cachedCitySearch,
  searchCity,
  searchOpenMeteo,
  searchPhoton,
} from "./geocoding";

/** Réponse Photon minimale, calquée sur une réponse réelle. */
function photonResponse() {
  return {
    features: [
      {
        properties: {
          name: "3e Arrondissement",
          city: "Lyon",
          state: "Auvergne-Rhône-Alpes",
          country: "France",
          osm_type: "R",
          osm_id: 120967,
          type: "district",
          extent: [4.82, 45.78, 4.87, 45.73],
        },
        geometry: { coordinates: [4.845, 45.755] },
      },
      {
        // Bruit réel de l'API : un numéro de rue, qui doit être écarté.
        properties: {
          name: "Lyon Part-Dieu",
          city: "Lyon",
          osm_type: "N",
          osm_id: 2337119617,
          type: "house",
        },
        geometry: { coordinates: [4.8586, 45.7605] },
      },
      {
        properties: {
          name: "Villeurbanne",
          country: "France",
          osm_type: "R",
          osm_id: 120968,
          type: "city",
          extent: [4.8583627, 45.7955875, 4.9212614, 45.7484524],
        },
        geometry: { coordinates: [4.8796267, 45.7660581] },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("searchPhoton", () => {
  it("transforme une réponse Photon en lieux scannables", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(photonResponse())) as unknown as typeof fetch;

    const places = await searchPhoton("Lyon 3e");

    // Les « house » sont filtrées : il ne reste que le district et la ville,
    // dans l'ordre de pertinence renvoyé par Photon (l'arrondissement d'abord).
    // Le district est préfixé par sa commune : « 3e Arrondissement » seul ne
    // dit rien une fois le champ rempli.
    expect(places.map((p) => p.shortName)).toEqual(["Lyon 3e Arrondissement", "Villeurbanne"]);

    const district = places[0];
    expect(district.osmType).toBe("relation");
    // Relation OSM → aire Overpass utilisable directement.
    expect(district.areaId).toBe(3_600_000_000 + 120967);
    // extent [minLon,maxLat,maxLon,minLat] → [sud, nord, ouest, est]
    expect(district.boundingBox).toEqual([45.73, 45.78, 4.82, 4.87]);
    expect(bboxString(district.boundingBox!)).toBe("45.73,4.82,45.78,4.87");
    expect(district.isLocality).toBe(false); // district, pas la commune
    expect(district.source).toBe("photon");

    // Le libellé affiché situe l'entité (« 3e Arrondissement, Lyon, ... »).
    expect(district.displayName).toContain("Lyon");
    expect(places[1].isLocality).toBe(true); // Villeurbanne est bien une commune
  });
});

describe("searchOpenMeteo", () => {
  it("fabrique une emprise, sinon Overpass ne pourrait rien scanner", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        results: [
          {
            id: 2996944,
            name: "Villeurbanne",
            latitude: 45.766,
            longitude: 4.88,
            country: "France",
            admin1: "Auvergne-Rhône-Alpes",
            population: 131_000,
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const places = await searchOpenMeteo("Villeurbanne");

    expect(places).toHaveLength(1);
    const [place] = places;
    expect(place.source).toBe("open-meteo");
    expect(place.osmType).toBe("geonames");
    // Aucune aire OSM (source différente)…
    expect(place.areaId).toBeNull();
    // …mais une emprise est TOUJOURS fournie (7 km pour 100k–500k habitants).
    expect(place.boundingBox).not.toBeNull();
    const [south, north, west, east] = place.boundingBox!;
    expect(south).toBeLessThan(45.766);
    expect(north).toBeGreaterThan(45.766);
    expect(west).toBeLessThan(4.88);
    expect(east).toBeGreaterThan(4.88);
    expect(north - south).toBeGreaterThan(0.1); // ~7 km → ~0,126°
  });
});

describe("searchCity", () => {
  it("bascule sur le fournisseur suivant quand le principal échoue", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      calls += 1;
      // Photon (1er fournisseur) renvoie une erreur définitive.
      if (String(input).includes("photon.komoot.io")) return jsonResponse({}, 503);
      // Suivant interrogé : réponse au format Nominatim (tableau).
      if (String(input).includes("nominatim.openstreetmap.org")) {
        return jsonResponse([
          {
            osm_type: "relation",
            osm_id: 120967,
            name: "3e Arrondissement",
            display_name: "3e Arrondissement, Lyon, Métropole de Lyon, France",
            lat: "45.755",
            lon: "4.845",
            boundingbox: ["45.73", "45.78", "4.82", "4.87"],
            address: { city: "Lyon", country: "France" },
          },
        ]);
      }
      return jsonResponse(photonResponse());
    }) as unknown as typeof fetch;

    const places = await searchCity("Lyon 3e");

    expect(calls).toBeGreaterThan(1); // le repli a bien été sollicité
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((p) => p.source === "nominatim")).toBe(true);
  });

  it("sert la seconde recherche depuis le cache, sans appel réseau", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });

    const fetchMock = vi.fn(async () => jsonResponse(photonResponse()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await searchCity("Villeurbanne");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedCitySearch("Villeurbanne")).not.toBeNull();

    const second = await searchCity("Villeurbanne");
    expect(second).toHaveLength(first.length);
    expect(second[0].source).toBe("cache");
    // Toujours un seul appel réseau : le cache a répondu.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("ne lance rien pour une requête trop courte", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await searchCity("Ly")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
