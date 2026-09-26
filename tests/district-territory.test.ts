/**
 * **A SEND IN COCHISE COUNTY PLACES THE DISTRICTS ITS OWN LAW BOUNDS, AND NAMES WHAT PLACES THE REST.** (2026-09-26,
 * the 85635 expansion.)
 *
 * On the committed data: Cochise County's community college district takes the county's territory (A.R.S. 15-1402);
 * Cochise Technology District takes its member districts' (A.R.S. 15-393), which is NOT the county, since Patagonia's
 * high school district lies in Santa Cruz County; the Fry and Palominas fire districts stay unplaced, naming the one
 * free boundary source and why it does not place them yet.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";
import { DISTRICT_TERRITORIES, ruledDistrictTerritory } from "@/lib/control-plane/expansion/district-territory.ts";
import { certainlyOverlaps, unitShareKey, type CensusUnitTerritory, type ScopeZctas } from "@/lib/control-plane/expansion/membership.ts";
import { readCensusUnitTerritories, readTerritoryIndex } from "@/lib/control-plane/expansion/runner-load.ts";
import type { JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";

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

const index = () => readTerritoryIndex(ROOT, ["az", "nh", "nj"].map(
  (s) => JSON.parse(readFileSync(join(ROOT, "data", "states", s, "jurisdictions", `${s}.json`), "utf8")) as JurisdictionRegistry,
));

test("A SEND IN 85635 OR COCHISE COUNTY PLACES THE COLLEGE DISTRICT AND THE TECHNOLOGY DISTRICT; SANTA CRUZ COUNTY DOES NOT GET THE COLLEGE", async () => {
  const idx = index();
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
  assert.ok(!jted.zctas.has("85624"), "Patagonia's own ZCTA is left out: its member district's territory is unresolved, so the union is a floor");
});

test("THE FIRE DISTRICTS STAY UNPLACED, NAMING THE SOURCE THAT WOULD PLACE THEM", () => {
  const idx = index();
  for (const id of [FRY, PALOMINAS]) {
    assert.equal(idx.bySubject.get(id), undefined, `${id} is not placed`);
    assert.match(idx.unplaced.get(id) ?? "", /no ZCTA territory, and no boundary source places it: .*Arizona Fire Districts.*approximate/);
  }
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
  const committed = readCensusUnitTerritories(ROOT).filter((u) => DISTRICT_TERRITORIES.some((r) => r.pid6 === u.pid6 && r.state === u.state));
  assert.deepEqual(committed.map((u) => u.zips.length), committed.map(() => 0), "every rule names a unit the committed data holds no territory for");
  assert.deepEqual(committed.map((u) => u.name).sort(), DISTRICT_TERRITORIES.map((r) => r.name).sort(), "each rule's pid6 is the unit it names");
});
