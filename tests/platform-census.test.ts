import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { observePlatformCensus } from "../lib/control-plane/discovery/platform-census.ts";
import { dotgovPlatformTenants } from "../lib/control-plane/discovery/platform-catalog.ts";

const NOW = "2026-10-12T12:00:00.000Z";
test("CISA supplies a government website lead with its actual state and immutable source version", () => {
  const csv = readFileSync(new URL("./fixtures/platform-census/dotgov.csv", import.meta.url), "utf8");
  const idaho = [...dotgovPlatformTenants(csv, "retained-cisa-version")].filter(row => row.state === "ID");
  assert.equal(idaho.length, 1);
  assert.equal(idaho[0].url, "https://aberdeenidaho.gov/");
  assert.equal(idaho[0].sourceVersion, "retained-cisa-version");
  assert.equal(idaho[0].platform, "government-website");
});
test("real BoardBook source markup supplies the published tenant and route on the census clock", () => {
  const html = readFileSync(new URL("./fixtures/boardbook-amphi-2065.html", import.meta.url), "utf8");
  const observation = observePlatformCensus(html, "https://meetings.boardbook.org/Public/Organization/2065", "capture", NOW);
  assert.ok(observation.matches.some(row => row.platform === "boardbook" && row.tenant === "2065"));
  assert.equal(observation.artifactId, "capture");
  assert.equal(observation.recheckAfter, "2026-10-13T00:00:00.000Z");
});
