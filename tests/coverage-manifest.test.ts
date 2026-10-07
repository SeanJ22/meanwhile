import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { US_JURISDICTIONS, jurisdictionFromOcdId } from "../lib/coverage/states.ts";
import { deriveArtifacts, heldStatesForDomain } from "../lib/coverage/artifacts.ts";
test("national geography identifies all states and DC without declaring artifact coverage", () => {
  assert.equal(US_JURISDICTIONS.filter(state => state.prefix !== "territory").length, 51);
  assert.equal(jurisdictionFromOcdId("ocd-division/country:us/district:dc/ward:1")?.fips, "11");
  assert.equal(jurisdictionFromOcdId("ocd-division/country:us/state:dc"), null);
  assert.equal(jurisdictionFromOcdId("ocd-division/country:us/state:xx"), null);
});

test("a first state holding appears only in its own artifact domain without code changes", () => {
  const root = mkdtempSync(join(tmpdir(), "s16-held-states-"));
  const put = (relative: string, value: unknown) => {
    const parts = relative.split("/");
    mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...parts), JSON.stringify(value));
  };
  try {
    assert.deepEqual(deriveArtifacts(root).states, []);
    put("data/states/wi/ballot/wi-dane-2028.json", { election: { state: "WI" }, contests: [] });
    put("data/states/wi/ballot/wi-brown-2028.json", { election: { state: "WI" }, contests: [] });
    put("data/states/wi/ballot/wi-dane-contacts.json", { contacts: [] });
    assert.equal(deriveArtifacts(root).ballotFiles.length, 2);
    assert.deepEqual(deriveArtifacts(root).states, []);
    assert.deepEqual(heldStatesForDomain(root, "ballot").map(state => state.usps), ["WI"]);
    put("data/states/dc/officials/officeholders-11.json", { officeholders: [] });
    put("data/states/hi/geo/sldu-15.geojson", { type: "FeatureCollection", features: [] });
    const held = deriveArtifacts(root);
    assert.deepEqual(held.states.map(state => state.usps), ["DC"]);
    assert.deepEqual(held.rosters, ["officeholders-11.json"]);
    assert.deepEqual(held.geometryStates.map(state => state.usps), ["HI"]);
    assert.equal(held.ballotFiles.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
