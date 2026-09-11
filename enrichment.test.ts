import { describe, expect, it } from "vitest";
import { computeEnrichment, detectSocial, isRealWebsite, SCORE_WEIGHTS } from "./enrichment";
import type { Venue } from "./types";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "node/1",
    osmType: "node",
    osmId: 1,
    name: "Test Bistro",
    venueType: "restaurant",
    lat: 45.75,
    lon: 4.85,
    address: "1 rue de Test, 69001 Lyon",
    phone: null,
    website: null,
    cuisine: null,
    openingHours: null,
    openHoursRecorded: false,
    rawTags: {},
    ...overrides,
  };
}

describe("isRealWebsite", () => {
  it("rejects facebook pages as a real website", () => {
    expect(isRealWebsite("https://facebook.com/myrestaurant")).toBe(false);
  });
  it("rejects instagram profiles", () => {
    expect(isRealWebsite("https://instagram.com/myrestaurant")).toBe(false);
  });
  it("accepts a real domain", () => {
    expect(isRealWebsite("https://myrestaurant.fr")).toBe(true);
  });
});

describe("detectSocial", () => {
  it("detects contact:facebook tag", () => {
    const v = makeVenue({ rawTags: { "contact:facebook": "https://facebook.com/x" } });
    expect(detectSocial(v)).toBe(true);
  });
  it("detects facebook URL stored as website", () => {
    const v = makeVenue({ website: "https://facebook.com/x" });
    expect(detectSocial(v)).toBe(true);
  });
  it("returns false without any social signal", () => {
    expect(detectSocial(makeVenue())).toBe(false);
  });
});

describe("computeEnrichment", () => {
  it("gives a blank venue a high-priority low score", () => {
    const e = computeEnrichment(makeVenue());
    expect(e.digitalScore).toBe(0);
    expect(e.priority).toBe("high");
    expect(e.checks.hasWebsite).toBe(false);
  });

  it("rewards a full digital footprint as low priority (disqualified)", () => {
    const v = makeVenue({
      website: "https://myrestaurant.fr",
      phone: "+33 4 00 00 00 00",
      openHoursRecorded: true,
      rawTags: { "contact:instagram": "https://instagram.com/myrestaurant" },
    });
    const e = computeEnrichment(v);
    // website 40 + social 30 + reviews 30 + phone 10 + hours 10 = 100 (capped)
    expect(e.digitalScore).toBe(
      Math.min(
        100,
        SCORE_WEIGHTS.website + SCORE_WEIGHTS.social + SCORE_WEIGHTS.reviews + SCORE_WEIGHTS.phone + SCORE_WEIGHTS.hours,
      ),
    );
    expect(e.priority).toBe("low");
  });

  it("treats a facebook-only web presence as no website", () => {
    const v = makeVenue({ website: "https://facebook.com/myrestaurant" });
    const e = computeEnrichment(v);
    expect(e.checks.hasWebsite).toBe(false);
    // social 30 + reviews heuristic does not fire (no real site) + phone 0 + hours 0
    expect(e.digitalScore).toBe(SCORE_WEIGHTS.social);
    expect(e.priority).toBe("high");
  });

  it("classifies medium priority between 40 and 69", () => {
    // socials (30) + phone (10) + hours (10) = 50, but no real website → medium
    const v = makeVenue({
      phone: "+33 1 22 33 44 55",
      openHoursRecorded: true,
      rawTags: { "contact:instagram": "https://instagram.com/myrestaurant" },
    });
    const e = computeEnrichment(v);
    expect(e.digitalScore).toBe(
      SCORE_WEIGHTS.social + SCORE_WEIGHTS.phone + SCORE_WEIGHTS.hours,
    );
    expect(e.priority).toBe("medium");
  });

  it("disqualifies a venue with a real website and review base", () => {
    const v = makeVenue({ website: "https://myrestaurant.fr" });
    const e = computeEnrichment(v);
    expect(e.priority).toBe("low");
    expect(e.checks.hasWebsite).toBe(true);
  });
});
