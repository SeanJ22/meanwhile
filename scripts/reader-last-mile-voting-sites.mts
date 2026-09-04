import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { POST } from "../app/api/voting-sites/route.ts";
import { loadVotingSites } from "../lib/ballot/voting-sites-server.ts";
import { contains, type GeoFeature } from "../lib/registry/resolve.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import type { VotingSitesAnswer } from "../lib/ballot/voting-sites.ts";

function interior(feature: GeoFeature): { lat: number; lng: number } {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const ring = polygon[0];
    const xs = ring.map((point) => point[0]); const ys = ring.map((point) => point[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
    for (const n of [2, 10, 30]) for (let x = 1; x < n; x++) for (let y = 1; y < n; y++) {
      const point: [number, number] = [minX + (maxX - minX) * x / n, minY + (maxY - minY) * y / n];
      if (contains(point, feature)) return { lat: point[1], lng: point[0] };
    }
  }
  throw new Error(`Cannot establish an interior fixture for ${feature.properties.ocdId}`);
}

/** Execute the real route; only the external address geocoder is replaced by a held-geometry fixture. */
export async function proveVotingSites() {
  const manifest = JSON.parse(readFileSync("data/derived/resolver-geometry.json", "utf8")) as { files: string[] };
  const features = manifest.files.flatMap((file) => (JSON.parse(readFileSync(file, "utf8")) as { features: GeoFeature[] }).features);
  const holdings = loadVotingSites();
  floored("voting-site jurisdiction controls", "canonical voting-sites snapshot", holdings.jurisdictions.length, holdings.jurisdictions.length);
  const results = [];
  const originalFetch = globalThis.fetch;
  try {
    for (const jurisdiction of holdings.jurisdictions) {
      // A state-level refusal is the fallback only where a more specific held
      // jurisdiction does not already supply sites. Use that actual contract.
      const fallbackLocal = holdings.jurisdictions.find((row) => row.ocdId.startsWith(`${jurisdiction.ocdId}/`) && row.sites.length === 0);
      const feature = features.find((row) => row.properties.ocdId === jurisdiction.ocdId)
        ?? features.find((row) => row.properties.ocdId === fallbackLocal?.ocdId);
      assert.ok(feature, `${jurisdiction.ocdId}: no canonical geography identity`);
      const point = interior(feature);
      globalThis.fetch = async (input) => {
        assert.ok(String(input).startsWith("https://geocoding.geo.census.gov/"), "only the external geocoder may be replaced");
        return Response.json({ result: { addressMatches: [{ coordinates: { x: point.lng, y: point.lat } }] } });
      };
      const response = await POST(new Request("http://localhost/api/voting-sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "Public geometry fixture" }) }));
      assert.equal(response.status, 200);
      const answer = await response.json() as VotingSitesAnswer;
      assert.equal(answer.match, true);
      const actual = answer.jurisdictions.find((row) => row.ocdId === jurisdiction.ocdId);
      assert.ok(actual, `${jurisdiction.ocdId}: eligible jurisdiction disappeared at the real route`);
      assert.deepEqual(actual.sites, jurisdiction.sites);
      assert.deepEqual(actual.refusal, jurisdiction.refusal);
      assert.equal(actual.sourceUrl, jurisdiction.sourceUrl);
      assert.equal(actual.model, jurisdiction.model);
      assert.ok(answer.jurisdictions.every((row) => row.state === jurisdiction.state), "wrong-state attachment");
      results.push({ jurisdictionId: jurisdiction.ocdId, geometryIdentity: feature.properties.ocdId, point, siteIds: actual.sites.map((site) => site.id), expectedCount: jurisdiction.sites.length, returnedCount: actual.sites.length, refusal: actual.refusal, sourceUrl: actual.sourceUrl, answer, payloadSha256: createHash("sha256").update(JSON.stringify(answer)).digest("hex") });
    }
  } finally { globalThis.fetch = originalFetch; }
  return { execution: "Every held voting jurisdiction through the actual POST handler and canonical filesystem/geography selectors. External Census geocoding alone is a deterministic interior-point fixture; no civic records, identities or reader payloads are stubbed. Deployed filesystem availability is separately required by reader-trace-check.", results };
}

if (process.argv[1]?.endsWith("reader-last-mile-voting-sites.mts")) {
  const result = await proveVotingSites();
  const proof = { ...result, exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceHashes: Object.fromEntries(["data/voting-sites.json", "app/api/voting-sites/route.ts", "lib/ballot/voting-sites-server.ts"].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) };
  writeFileSync("docs/evidence/reader-last-mile-voting-sites.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ jurisdictions: proof.results.length, sites: proof.results.reduce((total, row) => total + row.returnedCount, 0) }));
}
