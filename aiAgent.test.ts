import { describe, expect, it } from "vitest";
import {
  isGenericVenueName,
  nameTokens,
  normalizeName,
  plausibleDomainForName,
  probeSite,
  stripThinking,
} from "./aiAgent";

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
