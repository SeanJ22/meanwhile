/**
 * **A SEND IN COCHISE COUNTY PLACES THE DISTRICTS ITS OWN LAW BOUNDS, AND NAMES WHAT PLACES THE REST.** (2026-09-26,
 * the 85635 expansion.)
 *
 * On the committed data: Cochise County's community college district takes the county's territory (A.R.S. 15-1402);
 * Cochise Technology District takes its member districts' (A.R.S. 15-393), which is NOT the county, since Patagonia's
 * high school district lies in Santa Cruz County; the Fry and Palominas fire districts are placed for Sends by the
 * approximate DFFM boundary extract, sliver ZCTAs aside, and no reader path ever reads that extract.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";
import {
  APPROXIMATE_DISTRICT_EXTRACT_PATH,
  APPROXIMATE_MIN_SHARE,
  DISTRICT_TERRITORIES,
  ruledDistrictTerritory,
} from "@/lib/control-plane/expansion/district-territory.ts";
import { certainlyOverlaps, unitShareKey, type CensusUnitTerritory, type ScopeZctas } from "@/lib/control-plane/expansion/membership.ts";
import { readApproximateDistrictExtract, readCensusUnitTerritories, readTerritoryIndex } from "@/lib/control-plane/expansion/runner-load.ts";
import type { JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";
import { withSharedScopeDivisions } from "@/lib/control-plane/expansion/scope-divisions.ts";
import { CENSUS_SCHOOL_INTERSECTIONS } from "@/lib/control-plane/expansion/census-scope-observations.ts";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index.ts";
import { reviewedGovernmentsPlaced } from "@/lib/control-plane/expansion/send-preview.ts";

const ROOT = join(import.meta.dirname, "..");
const COLLEGE = "az:school:cochise-county-community-college-district";
const JTED = "az:school:cochise-technology-district";
const FRY = "az:special:fry-fire-district";
const PALOMINAS = "az:special:palominas-fire-district";

/** A Send scoped to one ZIP: its ZCTA, wholly inside. */
const ZIP_85635: ScopeZctas = { zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map() };

async function countyScope(geoid: string): Promise<ScopeZctas> {
  const result = await loadBootstrapLookup().zctasForGrouping({ type: "county", geoid, version: "county:2020" });
  assert.equal(result.status.kind, "OK");
  const fractions = new Map<string, number>();
  for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
  return { zctas: new Set(result.overlaps.map((o) => o.zcta5)), whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)), fractions };
}

/** The tracked files under app, components and lib naming any pattern; none is an empty list, never an error. */
function trackedFilesNaming(patterns: readonly string[]): string[] {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-l", ...patterns, "--", "app", "components", "lib"], { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
  }
  return out.split("\n").filter(Boolean).sort();
}

const index = () => readTerritoryIndex(ROOT, ["az", "nh", "nj"].map(
  (s) => JSON.parse(readFileSync(join(ROOT, "data", "states", s, "jurisdictions", `${s}.json`), "utf8")) as JurisdictionRegistry,
));

test("full Census school intersections reach both Admin scope and actual dispatch, including small slivers", async () => {
  const idx = index();
  const preview = withSharedScopeDivisions({ ids: [], partial: [], samples: 0 }, "85635");
  const reader = await zipDivisionEntry("85635");
  assert.ok(reader);
  const expected = [
    "az:school:sierra-vista-unified-school-district-68",
    "az:school:tombstone-school-district-1",
    "az:school:bisbee-unified-school-district-2",
    "az:depschool:fort-huachuca-accommodation-school",
    "az:school:palominas-school-district-49",
  ];
  assert.equal(CENSUS_SCHOOL_INTERSECTIONS.length, 5);
  for (const id of expected) {
    const territory = idx.bySubject.get(id);
    assert.ok(territory && certainlyOverlaps(territory, ZIP_85635), `${id} must be eligible for normal work creation`);
    assert.ok(territory.shares.get("85635")! > 0);
  }
  for (const row of CENSUS_SCHOOL_INTERSECTIONS) {
    assert.ok(preview.ids.includes(row.ocdId) && preview.partial.includes(row.ocdId));
    assert.ok(reader.ids.includes(row.ocdId) && reader.partial.includes(row.ocdId), `${row.name} must remain visible to ZIP readers as partial coverage`);
    assert.equal(row.zctaVintage, "2020");
    assert.match(row.sourceVintage, /January 1, 2026/);
  }
  assert.ok(idx.bySubject.get(expected[2])!.shares.get("85635")! < 0.000001, "do not discard the Census-positive Bisbee sliver");
  assert.deepEqual(withSharedScopeDivisions(preview, "85635"), preview, "repeat previews reuse the same identities");
  assert.deepEqual(withSharedScopeDivisions({ ids: [], partial: [], samples: 0 }, "03255").ids, [], "observations do not leak into other scopes");
});

test("A SEND IN 85635 OR COCHISE COUNTY PLACES THE COLLEGE DISTRICT AND THE TECHNOLOGY DISTRICT; SANTA CRUZ COUNTY DOES NOT GET THE COLLEGE", async () => {
  const idx = index();
  const registry = JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")) as JurisdictionRegistry;
  const preview = reviewedGovernmentsPlaced([{ zcta5: "85635", whole: true, fraction: 1, divisions: [], partial: [] }], registry, idx);
  const ids = preview.governments.map(body => body.id);
  assert.ok(ids.includes(COLLEGE) && ids.includes(JTED) && ids.includes(FRY), "Admin must preview the same special-district work the runner places");
  assert.ok(!ids.includes(PALOMINAS), "a county neighbour is not automatically in this ZIP");
  assert.match(preview.governments.find(body => body.id === FRY)!.basis, /discovery leads/);
  const college = idx.bySubject.get(COLLEGE);
  const jted = idx.bySubject.get(JTED);
  assert.ok(college !== undefined, `the college district is placed: ${idx.unplaced.get(COLLEGE)}`);
  assert.ok(jted !== undefined, `the technology district is placed: ${idx.unplaced.get(JTED)}`);
  const county = idx.bySubject.get("az:county:county-of-cochise")!;
  assert.deepEqual([...college.zctas].sort(), [...county.zctas].sort(), "the college district is its county");
  assert.ok(college.shares.size > 0, "with the county's sampled shares");
  assert.ok(certainlyOverlaps(college, ZIP_85635) && certainlyOverlaps(jted, ZIP_85635), "a Send in 85635 places both");
  const cochise = await countyScope("04003");
  assert.ok(certainlyOverlaps(college, cochise) && certainlyOverlaps(jted, cochise), "a Send in Cochise County places both");
  const santaCruz = await countyScope("04023");
  assert.ok(!certainlyOverlaps(college, santaCruz), "the college district is not in Santa Cruz County");
  assert.ok(!certainlyOverlaps(college, await countyScope("04019")), "nor in Pima County");
  assert.ok(jted.zctas.has("85624"), "Patagonia's secondary district supplies its actual Census boundary in Santa Cruz County");
  assert.ok(certainlyOverlaps(jted, santaCruz));
  const patagonia = readCensusUnitTerritories(ROOT, ["AZ"]).find(u => u.pid6 === "177987")!;
  assert.match(patagonia.method ?? "", /scsd GEOID 0406030/);
  assert.ok(patagonia.zips.includes("85624"));
});

test("THE FIRE DISTRICTS ARE PLACED FOR SENDS BY THEIR APPROXIMATE BOUNDARY: FRY IN 85635, PALOMINAS IN THE COUNTY BUT NOT 85635", async () => {
  const idx = index();
  const fry = idx.bySubject.get(FRY);
  const palominas = idx.bySubject.get(PALOMINAS);
  assert.ok(fry !== undefined && palominas !== undefined, `placed: ${idx.unplaced.get(FRY)} / ${idx.unplaced.get(PALOMINAS)}`);
  assert.ok(certainlyOverlaps(fry, ZIP_85635), "Fry Fire District covers part of 85635");
  assert.ok(!certainlyOverlaps(palominas, ZIP_85635), "Palominas lies south of Sierra Vista: not in an 85635 Send");
  const cochise = await countyScope("04003");
  assert.ok(certainlyOverlaps(fry, cochise) && certainlyOverlaps(palominas, cochise), "a Send in Cochise County places both");
  for (const t of [fry, palominas]) for (const share of t.shares.values()) assert.ok(share >= APPROXIMATE_MIN_SHARE, "no sliver places a district");
  const extract = readApproximateDistrictExtract(ROOT);
  assert.match(extract.provenance.approximate, /APPROXIMATE.*approximate.*wildfire dispatch.*never for a reader-facing governance claim/);
  assert.match(extract.provenance.url, /Arizona_Fire_Districts_Spatial_Join\/FeatureServer\/0$/);
  assert.match(extract.provenance.sha256, /^[0-9a-f]{64}$/);
  assert.equal(APPROXIMATE_MIN_SHARE, 0.05);
  const scoped = readTerritoryIndex(ROOT, [JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8"))], ["AZ"], ZIP_85635.zctas);
  const inZip = (territory: ReturnType<typeof readTerritoryIndex>) => [...territory.bySubject.values()]
    .filter(row => certainlyOverlaps(row, ZIP_85635)).map(row => row.subjectId).sort();
  assert.deepEqual(inZip(scoped), inZip(idx), "place reads preserve every placed government, including legal-member and approximate district territories");
  assert.ok(scoped.bySubject.size < idx.bySubject.size, "other places' registries and shares do not enter the place index");
});

test("A SLIVER IS NOT PLACEMENT: an approximate district holding under 5% of a ZCTA is not placed by it", () => {
  const extract = {
    ...readApproximateDistrictExtract(ROOT),
    districts: [{ name: "Sliver Fire District", pid6: "999999", unitName: "SLIVER FIRE DISTRICT", zctas: { "85001": 0.049, "85002": 0.3 } }],
  };
  const ruled = ruledDistrictTerritory({ state: "AZ", pid6: "999999" }, new Map(), () => undefined, unitShareKey, [], extract);
  assert.ok(ruled !== null && "zctas" in ruled);
  assert.deepEqual([...ruled.zctas], ["85002"]);
  assert.match(ruled.method, /^APPROXIMATE, for Send placement only/);
  const none = ruledDistrictTerritory({ state: "AZ", pid6: "999999" }, new Map(), () => undefined, unitShareKey, [], { ...extract, districts: [{ ...extract.districts[0]!, zctas: { "85001": 0.01 } }] });
  assert.ok(none !== null && "unplaced" in none);
  assert.equal(ruledDistrictTerritory({ state: "NM", pid6: "999999" }, new Map(), () => undefined, unitShareKey, [], extract), null, "an Arizona extract places no other state's unit");
});

test("only non-reader placement callers load the approximate boundary extract", () => {
  /* Outside tests and the generator, the extract is named only where the runner reads it. */
  const namers = trackedFilesNaming(["-e", "az-fire-district-territory", "-e", "APPROXIMATE_DISTRICT_EXTRACT_PATH", "-e", "readApproximateDistrictExtract"]);
  assert.deepEqual(namers, ["lib/control-plane/expansion/district-territory.ts", APPROXIMATE_DISTRICT_EXTRACT_PATH.join("/"), "lib/control-plane/expansion/runner-load.ts"]);
  const importers = trackedFilesNaming(["-e", "expansion/runner-load"]);
  assert.deepEqual(importers, ["app/(admin)/_mw/data/send-preview.ts", "lib/funding/fec-send-districts.ts", "lib/hunt/place-source-admission.ts"], "only Admin preview and hunt admission load dispatch placement; no public reader does");
});

test("THE RULES: each names its evidence; a member union never adds shares and names what it leaves out; an unknown unit has no rule", () => {
  for (const rule of DISTRICT_TERRITORIES) {
    assert.ok(rule.evidence.length > 0 && rule.evidence.every((e) => e.trim() !== ""), `${rule.name} carries evidence`);
    assert.match(rule.observed.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
  const units = new Map<string, CensusUnitTerritory>([
    ["ZZ:1", { pid6: "1", name: "A", type: "SCHOOL DISTRICT", state: "ZZ", zips: ["00001", "00002"], method: "elsd GEOID 1" }],
    ["ZZ:2", { pid6: "2", name: "B", type: "SCHOOL DISTRICT", state: "ZZ", zips: ["00002"], method: "scsd GEOID 2" }],
  ]);
  const shares = new Map([["elsd:1", new Map([["00002", 0.4]])], ["scsd:2", new Map([["00002", 0.7]])]]);
  const union = ruledDistrictTerritory({ state: "ZZ", pid6: "9" }, units, (k) => shares.get(k), unitShareKey, [{
    state: "ZZ", pid6: "9", name: "J", evidence: ["x"], observed: { at: "2026-09-26T00:00:00Z", by: "t" },
    rule: { kind: "MEMBER_UNION", members: [{ pid6: "1", name: "A" }, { pid6: "2", name: "B" }, { pid6: "3", name: "C" }], unresolved: [{ pid6: "4", name: "D", why: "unresolved" }] },
  }]);
  assert.ok(union !== null && "zctas" in union);
  assert.deepEqual([...union.zctas].sort(), ["00001", "00002"]);
  assert.equal(union.shares.get("00002"), 0.7, "overlapping members: the larger share, never the sum");
  assert.match(union.method, /union of 2 member district\(s\).*D \(unresolved\); C \(no territory in the committed data\)/);
  assert.equal(ruledDistrictTerritory({ state: "ZZ", pid6: "8" }, units, () => undefined, unitShareKey, []), null);
  const committed = readCensusUnitTerritories(ROOT, DISTRICT_TERRITORIES.map(rule => rule.state)).filter((u) => DISTRICT_TERRITORIES.some((r) => r.pid6 === u.pid6 && r.state === u.state));
  assert.deepEqual(committed.map((u) => u.zips.length), committed.map(() => 0), "every rule names a unit the committed data holds no territory for");
  assert.deepEqual(committed.map((u) => u.name).sort(), DISTRICT_TERRITORIES.map((r) => r.name).sort(), "each rule's pid6 is the unit it names");
});
