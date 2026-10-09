import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBootstrapLookup } from "../lib/census-geography/reader.ts";
import { withCensusDistricts } from "../lib/geo/zip-census-districts.ts";
import type { CodeSlice, Slice } from "../lib/control-plane/admin-view/promoted-slices.ts";

async function fixture(): Promise<Slice<CodeSlice> & { kind: "HELD" }> {
  const lookup = loadBootstrapLookup();
  const result = await lookup.groupingsForZcta("85635");
  const types = ["congressional_district", "state_leg_upper", "state_leg_lower"];
  const memberships = result.memberships.filter(m => types.includes(m.geography.type));
  return { kind: "HELD", versionId: "isolated-census-fixture", value: {
    known: true, zctaTabulations: ["2020"],
    scopes: memberships.map(m => ({ type: m.geography.type, version: m.geography.version, plan: m.geography.version })),
    containers: memberships.map(m => ({ ref: m.geography, plan: m.geography.version, overlaps: [{ zcta5: "85635", whole: m.whole, fraction: m.fraction }] })),
  } };
}

test("85635's published full CD6 and LD19 overlap removes uncertainty the old district-less sample could not resolve", async () => {
  const old = { ids: ["ocd-division/country:us/state:az/place:sierra_vista"], partial: ["ocd-division/country:us/state:az/place:sierra_vista"], samples: 19 };
  const joined = withCensusDistricts(old, await fixture(), "85635");
  for (const district of ["cd:6", "sldu:19", "sldl:19"]) {
    assert.ok(joined.ids.includes(`ocd-division/country:us/state:az/${district}`));
    assert.ok(!joined.partial.includes(`ocd-division/country:us/state:az/${district}`));
  }
  assert.deepEqual(joined.partial, old.partial, "actual local boundary uncertainty is retained");
  assert.ok(!joined.ids.includes("ocd-division/country:us/state:az/cd:7"));
});

test("partial Census coverage remains partial, while missing reads and conflicting vintages cannot manufacture certainty", async () => {
  const old = { ids: [], partial: [], samples: 19 };
  const source = await fixture();
  const partial: typeof source = { ...source, value: { ...source.value, containers: source.value.containers.map(c => ({ ...c, overlaps: [{ zcta5: "85635", whole: false, fraction: 0.4 }] })) } };
  const joined = withCensusDistricts(old, partial, "85635");
  assert.ok(joined.partial.includes("ocd-division/country:us/state:az/cd:6"));
  assert.deepEqual(withCensusDistricts(old, { kind: "UNREAD", detail: "source failed" }, "85635"), old);
  const conflicting: typeof source = { ...source, value: { ...source.value, scopes: [...source.value.scopes, { type: "congressional_district", version: "cd:ambiguous", plan: "Conflicting plan", applicability: [{ purpose: "representation", from: "2025-01-01", through: "2027-01-01" }] }] } };
  assert.ok(!withCensusDistricts(old, conflicting, "85635").ids.includes("ocd-division/country:us/state:az/cd:6"));
});


test("serving and election families replace atomically; an unknown ballot plan never keeps serving districts", async () => {
  const source = await fixture();
  const old = { ids: ["ocd-division/country:us/state:az/cd:7", "ocd-division/country:us/state:az/sldu:1", "ocd-division/country:us/state:az/place:sierra_vista"], partial: [], samples: 10 };
  const serving = withCensusDistricts(old, source, "85635", { purpose: "representation", asOf: "2026-10-09" });
  assert.ok(serving.ids.includes("ocd-division/country:us/state:az/cd:6"));
  assert.ok(!serving.ids.includes("ocd-division/country:us/state:az/cd:7"));
  const election = withCensusDistricts(old, source, "85635", { purpose: "election", asOf: "2026-10-09", electionDate: "2026-11-03" });
  assert.deepEqual(election.ids, ["ocd-division/country:us/state:az/place:sierra_vista"]);
  const failed = withCensusDistricts(old, { kind: "UNREAD", detail: "no applicable plan" }, "85635", { purpose: "election", asOf: "2026-10-09", electionDate: "2026-11-03" });
  assert.deepEqual(failed.ids, election.ids);
});
