import { describe, expect, it } from "vitest";
import {
  isGenericVenueName,
  mapAiVenues,
  nameTokens,
  normalizeName,
  plausibleDomainForName,
  probeSite,
  stripThinking,
} from "./aiAgent";

/**
 * Repli utilisé quand AUCUN miroir OpenStreetMap ne répond : la liste est
 * reconstituée par le modèle. Ces tests vérifient qu'aucune donnée incertaine
 * n'est inventée et que les fiches sont clairement marquées comme estimées.
 */
describe("mapAiVenues", () => {
  const target = { displayName: "Lyon 3e, France", shortName: "Lyon 3e", lat: 45.76, lon: 4.85 };

  it("marque les fiches comme estimées et les identifie hors OSM", () => {
    const venues = mapAiVenues(
      [
        { nom: "Chez Grégoire", type: "boulangerie", adresse: "12 rue Exemple", telephone: "04 78 00 00 00", site_web: "exemple.fr" },
        { nom: "Snack du Parc", type: "fast food" },
      ],
      target,
    );
    expect(venues).toHaveLength(2);
    expect(venues[0].origin).toBe("ia");
    expect(venues[0].venueType).toBe("bakery");
    expect(venues[1].venueType).toBe("fast_food");
    expect(venues[0].osmId).toBeLessThan(0);
    expect(venues[0].website).toBe("https://exemple.fr");
    expect(venues[1].address).toBe("—");
  });

  it("écarte les noms manquants ou manifestement inconnus", () => {
    const venues = mapAiVenues(
      [{ nom: "" }, { nom: "inconnu" }, { nom: "N/A" }, { nom: "  " }, { nom: "Vrai Commerce" }],
      target,
    );
    expect(venues.map((v) => v.name)).toEqual(["Vrai Commerce"]);
  });

  it("dédoublonne les noms (accents, casse et ponctuation ignorés)", () => {
    const venues = mapAiVenues(
      [{ nom: "Chez Grégoire" }, { nom: "chez gregoire" }, { nom: "Chez Gregoire!" }],
      target,
    );
    expect(venues).toHaveLength(1);
  });

  it("n'invente ni téléphone ni site : les valeurs douteuses restent vides", () => {
    const venues = mapAiVenues(
      [
        { nom: "Pizzeria Test", telephone: "aucun", site_web: "pas de site" },
        { nom: "Bistrot Test", site_web: "http://" },
      ],
      target,
    );
    expect(venues[0].phone).toBeNull();
    expect(venues[0].website).toBeNull();
    expect(venues[1].website).toBeNull();
  });

  it("répartit les fiches près du centre (aucune position prétendue exacte)", () => {
    const venues = mapAiVenues(
      Array.from({ length: 20 }, (_, i) => ({ nom: `Commerce ${i}` })),
      target,
    );
    expect(venues).toHaveLength(20);
    for (const v of venues) {
      expect(Math.abs(v.lat - target.lat)).toBeLessThan(0.03);
      expect(Math.abs(v.lon - target.lon)).toBeLessThan(0.03);
    }
    // Positions distinctes (aucune superposition exacte).
    expect(new Set(venues.map((v) => `${v.lat},${v.lon}`)).size).toBe(20);
  });

  it("tolère une réponse vide ou malformée du modèle", () => {
    expect(mapAiVenues(undefined, target)).toEqual([]);
    expect(mapAiVenues("texte", target)).toEqual([]);
    expect(mapAiVenues([null, 3], target)).toEqual([]);
  });
});

describe("normalizeName", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalizeName("Le Bon beurre")).toBe("le bon beurre");
    expect(normalizeName("Chez Grégoire")).toBe("chez gregoire");
    expect(normalizeName("Bâton Rouge!")).toBe("baton rouge");
  });
});

describe("nameTokens", () => {
  it("drops filler articles and generic category words", () => {
    expect(nameTokens("Le Bistrot du Coin")).toEqual([]);
    expect(nameTokens("Café de la Soierie")).toEqual(["soierie"]);
  });
  it("keeps distinctive words", () => {
    expect(nameTokens("Au Petit Poisson Rouge")).toEqual(["petit", "poisson", "rouge"]);
  });
});

describe("isGenericVenueName", () => {
  it("flags names with no distinctive token", () => {
    expect(isGenericVenueName("Le local")).toBe(true);
    expect(isGenericVenueName("Bar du coin")).toBe(true);
    expect(isGenericVenueName("Le Restaurant")).toBe(true);
  });
  it("accepts distinctive names", () => {
    expect(isGenericVenueName("Midori")).toBe(false);
    expect(isGenericVenueName("Chez Grégoire")).toBe(false);
    expect(isGenericVenueName("Au Petit Poisson Rouge")).toBe(false);
  });
});

describe("plausibleDomainForName", () => {
  it("accepts a domain containing a distinctive name token as a word", () => {
    expect(plausibleDomainForName("Au Petit Poisson Rouge", "https://aupetitpoissonrouge.fr")).toBe(true);
    expect(plausibleDomainForName("Café Bouillet", "https://bouillet-lyon.fr")).toBe(true);
    expect(plausibleDomainForName("Bes'cakes", "https://bescakes.fr")).toBe(true);
  });
  it("rejects a domain that merely contains a token as substring of another brand", () => {
    // "Belle" must not match "belfort..." — word-boundary check
    expect(plausibleDomainForName("Belle Époque", "https://belleville-pizza.fr")).toBe(false);
    // Short token "midori" inside "midoricafe" as part of a longer word → only
    // whole-word matches count
    expect(plausibleDomainForName("Maison Poupoule", "https://pouponnette.fr")).toBe(false);
  });
  it("rejects everything for generic names", () => {
    expect(plausibleDomainForName("Le local", "https://lelocal.fr")).toBe(false);
  });
});

describe("stripThinking", () => {
  it("removes reasoning blocks", () => {
    expect(stripThinking("<think>hmm</think>Answer")).toBe("Answer");
    expect(stripThinking("Before<think>...")).toBe("Before");
  });
});

describe("probeSite", () => {
  it("resolves ok=false for an unreachable host", async () => {
    const res = await probeSite("https://does-not-exist-glf.invalid", 1500);
    expect(res.ok).toBe(false);
    expect(res.loadMs).toBeNull();
  });
}, 10_000);
