import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import test from "node:test";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeByState, censusDistrictEdgeSlice } from "../lib/census-geography/district-edge.ts";
import { postalArea } from "../lib/geo/postal.ts";

import { createLookup } from "../lib/census-geography/lookup.ts";

const dataset = JSON.parse(readFileSync(new URL("../lib/census-geography/bootstrap-az.json", import.meta.url), "utf8")) as BuiltDataset;
const edge = buildCensusDistrictEdge(dataset, "isolated-promoted-census");

test("the compact edge preserves every published district membership and its whole/partial evidence", async () => {
  const lookup = createLookup(dataset, "isolated-promoted-census");
  let compared = 0;
  for (const zip of dataset.zctaUniverse) {
    const expected = (await lookup.groupingsForZcta(zip)).memberships.filter(m => ["congressional_district", "state_leg_upper", "state_leg_lower"].includes(m.geography.type));
    const slice = censusDistrictEdgeSlice(edge, edge.versionId, zip);
    assert.equal(slice.kind, "HELD");
    if (slice.kind !== "HELD") continue;
    const actual = slice.value.containers.map(c => [c.ref.type, c.ref.geoid, c.ref.version, c.overlaps?.[0].whole, c.overlaps?.[0].fraction]);
    const wanted = expected.map(m => [m.geography.type, m.geography.geoid, m.geography.version, m.whole, m.fraction]);
    assert.deepEqual(actual.sort(), wanted.sort(), zip);
    compared += actual.length;
  }
  assert.ok(compared > 500, "compares the held geography, not a one-ZIP fixture");
});

const stateOf = (zip: string) => postalArea(zip)?.state ?? "US";

test("each state's shard answers its ZIPs exactly as the national edge does, and its version names only its own content", () => {
  const shards = censusDistrictEdgeByState(edge, stateOf);
  for (const zip of dataset.zctaUniverse) {
    const shard = shards.get(stateOf(zip))!;
    assert.deepEqual(censusDistrictEdgeSlice(shard, shard.versionId, zip), { ...censusDistrictEdgeSlice(edge, edge.versionId, zip), versionId: shard.versionId }, zip);
  }
  const again = censusDistrictEdgeByState(buildCensusDistrictEdge(dataset, "a-later-national-version"), stateOf);
  assert.deepEqual([...again].map(([state, shard]) => [state, shard.versionId]), [...shards].map(([state, shard]) => [state, shard.versionId]),
    "a national release that leaves a state's districts alone leaves its pointer alone");
});

test("unknown ZIPs, mismatched versions and malformed overlaps never manufacture certainty", () => {
  const missing = censusDistrictEdgeSlice(edge, edge.versionId, "00000");
  assert.ok(missing.kind === "HELD" && !missing.value.known);
  assert.equal(censusDistrictEdgeSlice(edge, "different-version", "85635").kind, "UNREAD");
  assert.equal(censusDistrictEdgeSlice({ ...edge, codes: { "85635": [[999999, true, 1]] } }, edge.versionId, "85635").kind, "UNREAD");
});
