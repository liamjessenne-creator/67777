import { describe, expect, it } from "vitest";
import { elementToVenue, parseOverpassBody } from "./overpass";

/**
 * Ces tests couvrent les causes réelles des échecs « ça marche 1 fois sur 2 »
 * constatées sur les miroirs Overpass publics : une page HTML d'erreur renvoyée
 * avec un code 200 doit être REJETÉE (avant, `res.json()` levait une erreur
 * générique et le miroir était abandonné sans raison exploitable).
 */
describe("parseOverpassBody", () => {
  it("rejette la page HTML d'erreur OSM3S renvoyée avec un code 200", () => {
    const html =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN">' +
      '<html><body><p><strong style="color:#FF0000">Error: runtime error</strong></p></body></html>';
    expect(parseOverpassBody(html)).toBeNull();
  });

  it("rejette un JSON tronqué ou sans tableau `elements`", () => {
    expect(parseOverpassBody('{"version":0.6,"elements":')).toBeNull();
    expect(parseOverpassBody('{"version":0.6}')).toBeNull();
    expect(parseOverpassBody("")).toBeNull();
  });

  it("accepte une réponse valide, même sans commerce", () => {
    expect(parseOverpassBody('{"version":0.6,"elements":[]}')?.elements).toEqual([]);
    expect(
      parseOverpassBody('{"elements":[{"type":"node","id":1,"lat":45.7,"lon":4.8}]}')?.elements,
    ).toHaveLength(1);
  });
});

describe("elementToVenue", () => {
  it("convertit un restaurant OSM en fiche `osm` avec son adresse", () => {
    const venue = elementToVenue({
      type: "node",
      id: 42,
      lat: 45.764,
      lon: 4.8357,
      tags: {
        name: "Le Bouchon",
        amenity: "restaurant",
        "addr:housenumber": "12",
        "addr:street": "rue Mercière",
        "addr:postcode": "69002",
        "addr:city": "Lyon",
        "contact:website": "https://bouchon.fr",
        opening_hours: "Mo-Sa 12:00-14:00",
      },
    });
    expect(venue).not.toBeNull();
    expect(venue?.origin).toBe("osm");
    expect(venue?.id).toBe("node/42");
    expect(venue?.venueType).toBe("restaurant");
    expect(venue?.address).toBe("12 rue Mercière, 69002 Lyon");
    expect(venue?.website).toBe("https://bouchon.fr");
    expect(venue?.openHoursRecorded).toBe(true);
  });

  it("utilise le centre d'un way (out center) et la boulangerie via `shop`", () => {
    const venue = elementToVenue({
      type: "way",
      id: 7,
      center: { lat: 45.75, lon: 4.85 },
      tags: { name: "Chez Paul", shop: "bakery" },
    });
    expect(venue?.venueType).toBe("bakery");
    expect(venue?.lat).toBe(45.75);
    expect(venue?.address).toBe("—");
    expect(venue?.openHoursRecorded).toBe(false);
  });

  it("écarte les commerces sans nom, sans position ou hors restauration", () => {
    expect(
      elementToVenue({ type: "node", id: 1, lat: 45, lon: 4, tags: { amenity: "restaurant" } }),
    ).toBeNull();
    expect(
      elementToVenue({ type: "node", id: 2, tags: { name: "Sans position", amenity: "cafe" } }),
    ).toBeNull();
    expect(
      elementToVenue({ type: "node", id: 3, lat: 45, lon: 4, tags: { name: "La Banque", amenity: "bank" } }),
    ).toBeNull();
  });
});
