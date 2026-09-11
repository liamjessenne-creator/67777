/**
 * Quick Overpass query validation script (dev-only, not part of the app bundle).
 * Usage: node scripts/overpass-test.mjs "Lyon"
 */
import fs from "node:fs";

const city = process.argv[2] ?? "Lyon";
const geoRes = await fetch(
  `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=jsonv2&limit=1`,
  { headers: { Accept: "application/json", "User-Agent": "GeoLeadFinderAI-Test/1.0 (internal audit tool)" } },
);
const geo = await geoRes.json();
const rel = geo[0];
console.log("Geocoded:", rel.display_name, "| osm_type:", rel.osm_type, "| osm_id:", rel.osm_id);

const areaId = rel.osm_type === "relation" ? 3600000000 + rel.osm_id : null;
if (!areaId) {
  console.error("Not a relation — no area id");
  process.exit(1);
}

const bbox = rel.boundingbox.map(Number);
const bboxStr = `${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]}`;

const queries = {
  area: `[out:json][timeout:60];
area(${areaId})->.searchArea;
(
  nwr[amenity~"^(restaurant|fast_food|cafe|bar|pub|bakery)$"](area.searchArea);
  nwr[shop~"^(bakery|pastry)$"][name](area.searchArea);
);
out center 200;`,
  bbox: `[out:json][timeout:60];
(
  nwr[amenity~"^(restaurant|fast_food|cafe|bar|pub|bakery)$"](${bboxStr});
  nwr[shop~"^(bakery|pastry)$"][name](${bboxStr});
);
out center 200;`,
};

const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

for (const [name, query] of Object.entries(queries)) {
  for (const endpoint of endpoints) {
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GeoLeadFinderAI-Test/1.0 (internal audit tool)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(150000),
      });
      const text = await res.text();
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.status === 200) {
        const json = JSON.parse(text);
        console.log(`[${name}] ${new URL(endpoint).hostname} → 200, ${json.elements.length} elements in ${secs}s`);
        fs.writeFileSync(`scripts/result-${name}.json`, text);
      } else {
        console.log(`[${name}] ${new URL(endpoint).hostname} → ${res.status} in ${secs}s: ${text.slice(0, 120)}`);
      }
    } catch (err) {
      console.log(`[${name}] ${new URL(endpoint).hostname} → ERR ${err.message} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
}
