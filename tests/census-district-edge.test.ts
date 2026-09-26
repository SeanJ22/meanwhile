import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeSlice } from "../lib/census-geography/district-edge.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { publishedZipDistricts, withCensusDistricts } from "../lib/geo/zip-census-districts.ts";

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

test("85635 resolves through the request edge without a database and retains real local uncertainty", async () => {
  const slice = await withReaderAuthorityEdge({ censusDistricts: { value: edge, versionId: edge.versionId } }, () => publishedZipDistricts("85635"));
  const local = "ocd-division/country:us/state:az/place:sierra_vista";
  const result = withCensusDistricts({ ids: [local], partial: [local], samples: 19 }, slice, "85635");
  for (const suffix of ["cd:6", "sldu:19", "sldl:19"]) assert.ok(result.ids.includes(`ocd-division/country:us/state:az/${suffix}`));
  assert.deepEqual(result.partial, [local]);
  assert.equal((await withReaderAuthorityEdge({ edgeOnly: true }, () => publishedZipDistricts("85635"))).kind, "UNREAD");
});

test("unknown ZIPs, mismatched versions and malformed overlaps never manufacture certainty", () => {
  const missing = censusDistrictEdgeSlice(edge, edge.versionId, "00000");
  assert.ok(missing.kind === "HELD" && !missing.value.known);
  assert.equal(censusDistrictEdgeSlice(edge, "different-version", "85635").kind, "UNREAD");
  assert.equal(censusDistrictEdgeSlice({ ...edge, codes: { "85635": [[999999, true, 1]] } }, edge.versionId, "85635").kind, "UNREAD");
});
