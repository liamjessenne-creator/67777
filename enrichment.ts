/**
 * Digital-presence scoring.
 *
 * Formula (per spec):
 *   Has Website            +40
 *   > 50 Google reviews    +30   (heuristic fall-back when no Places key)
 *   Active socials         +30
 *   Phone listed           bonus visibility only
 *
 * Targets are venues with score < 40.
 */

import type { Enrichment, PriorityTier, Venue } from "./types";

export const SCORE_WEIGHTS = {
  website: 40,
  reviews: 30,
  social: 30,
  phone: 10,
  hours: 10,
} as const;

/**
 * OSM heuristic: venues with a Facebook/Instagram/TripAdvisor URL as their
 * only web presence are de-facto "no real website".
 */
export function isRealWebsite(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (u.length < 4) return false; // empty or garbage
  if (u.includes("facebook.com")) return false;
  if (u.includes("instagram.com")) return false;
  if (u.includes("tripadvisor.")) return false;
  return true;
}

const SOCIAL_KEYS = [
  "contact:facebook",
  "contact:instagram",
  "contact:twitter",
  "contact:youtube",
  "contact:tiktok",
  "facebook",
  "instagram",
];

export function detectSocial(venue: Venue): boolean {
  for (const key of SOCIAL_KEYS) {
    if (venue.rawTags[key]) return true;
  }
  // A facebook/instagram URL stored as the website counts as a social presence
  const web = (venue.website ?? "").toLowerCase();
  return web.includes("facebook.com") || web.includes("instagram.com");
}

/** Estimated review count from OSM signals (conservative — no fabrication). */
export function estimateReviewCount(venue: Venue): number | null {
  if (venue.rawTags["stars"]) return null; // hotel-style tag, not reviews
  // A real website implies an established business with some review base.
  // Heuristic ONLY; with a Google Places key, real counts replace it.
  if (isRealWebsite(venue.website ?? "")) return 60;
  return null;
}

export function computeEnrichment(venue: Venue): Enrichment {
  const signals: string[] = [];
  let score = 0;

  const rawWebsite = venue.website;
  const hasRealSite = rawWebsite ? isRealWebsite(rawWebsite) : false;
  const socialOnly = Boolean(rawWebsite) && !hasRealSite;

  if (hasRealSite) {
    score += SCORE_WEIGHTS.website;
    signals.push(`Real website found (${rawWebsite})`);
  } else if (socialOnly) {
    signals.push("Only a social page instead of a website");
  } else {
    signals.push("No website recorded on OpenStreetMap");
  }

  const hasSocial = detectSocial(venue);
  if (hasSocial) {
    score += SCORE_WEIGHTS.social;
    signals.push("Social media presence detected");
  } else {
    signals.push("No social media detected");
  }

  const reviews = estimateReviewCount(venue);
  if (reviews != null && reviews > 50) {
    score += Math.min(SCORE_WEIGHTS.reviews, 30);
    signals.push(`Estimated established review base (~${reviews}+)`);
  } else {
    signals.push("No evidence of a strong review base");
  }

  const hasPhone = Boolean(venue.phone);
  if (hasPhone) {
    score += SCORE_WEIGHTS.phone;
    signals.push("Phone number listed");
  } else {
    signals.push("No phone number recorded");
  }

  if (venue.openHoursRecorded) {
    score += SCORE_WEIGHTS.hours;
    signals.push("Opening hours published");
  } else {
    signals.push("Opening hours not published online");
  }

  const priority: PriorityTier = score < 40 ? "high" : score < 70 ? "medium" : "low";

  return {
    digitalScore: Math.min(score, 100),
    priority,
    checks: {
      hasWebsite: hasRealSite,
      hasSocial,
      hasPhone,
      reviewsKnown: reviews != null,
      reviewCount: reviews,
      rating: null,
      source: "osm-heuristic",
    },
    signals,
  };
}
