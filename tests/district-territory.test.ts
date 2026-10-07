/**
 * A Send places every district its own law bounds: a county community college district takes the county's territory;
 * a technology district takes its member districts', which need not be the county.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";
import {
  DISTRICT_TERRITORIES,
  ruledDistrictTerritory,
} from "@/lib/control-plane/expansion/district-territory.ts";
import { certainlyOverlaps, unitShareKey, type CensusUnitTerritory, type ScopeZctas } from "@/lib/control-plane/expansion/membership.ts";
import { readCensusUnitTerritories, readTerritoryIndex } from "@/lib/control-plane/expansion/runner-load.ts";
import type { Jurisdiction, JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";
import { reviewedGovernmentsPlaced } from "@/lib/control-plane/expansion/send-preview.ts";

const ROOT = join(import.meta.dirname, "..");
const COUNTY = "az:county:county-of-cochise";
const COLLEGE = "az:school:cochise-county-community-college-district";
const JTED = "az:school:cochise-technology-district";

/** A Send scoped to one ZIP: its ZCTA, wholly inside. */
const ZIP_SCOPE: ScopeZctas = { zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map() };

const government = (id: string, name: string, govClass: Jurisdiction["govClass"]): Jurisdiction => ({
  id, stateCode: "AZ", name, govClass, countyName: "COCHISE", enumeratedFrom: "census-govt-units-2022", ownWebAddress: null, sourceIds: [],
}) as unknown as Jurisdiction;

const REGISTRY = {
  formatVersion: 1, stateCode: "AZ", generatedBy: "test", generatedOn: "2026-09-26", _note: [],
  enumerationSources: [{ id: "census-govt-units-2022", describe: "test", path: "test", rowsRead: 3 }],
  counts: {}, disagreements: [], sourceCatalog: {},
  jurisdictions: [
    government(COUNTY, "COUNTY OF COCHISE", "COUNTY"),
    government(COLLEGE, "COCHISE COUNTY COMMUNITY COLLEGE DISTRICT", "SCHOOL_DISTRICT"),
    government(JTED, "COCHISE TECHNOLOGY DISTRICT", "SCHOOL_DISTRICT"),
  ],
} as unknown as JurisdictionRegistry;

async function countyScope(geoid: string): Promise<ScopeZctas> {
  const result = await loadBootstrapLookup().zctasForGrouping({ type: "county", geoid, version: "county:2020" });
  assert.equal(result.status.kind, "OK");
  const fractions = new Map<string, number>();
  for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
  return { zctas: new Set(result.overlaps.map((o) => o.zcta5)), whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)), fractions };
}

const index = () => readTerritoryIndex(ROOT, [REGISTRY]);

test("A SEND IN 85635 OR COCHISE COUNTY PLACES THE COLLEGE DISTRICT AND THE TECHNOLOGY DISTRICT; SANTA CRUZ COUNTY DOES NOT GET THE COLLEGE", async () => {
  const idx = index();
  const preview = reviewedGovernmentsPlaced([{ zcta5: "85635", whole: true, fraction: 1, divisions: [], partial: [] }], REGISTRY, idx);
  const ids = preview.governments.map(body => body.id);
  assert.ok(ids.includes(COLLEGE) && ids.includes(JTED), "Admin must preview the same special-district work the runner places");
  const college = idx.bySubject.get(COLLEGE);
  const jted = idx.bySubject.get(JTED);
  assert.ok(college !== undefined, `the college district is placed: ${idx.unplaced.get(COLLEGE)}`);
  assert.ok(jted !== undefined, `the technology district is placed: ${idx.unplaced.get(JTED)}`);
  const county = idx.bySubject.get(COUNTY)!;
  assert.deepEqual([...college.zctas].sort(), [...county.zctas].sort(), "the college district is its county");
  assert.ok(college.shares.size > 0, "with the county's sampled shares");
  assert.ok(certainlyOverlaps(college, ZIP_SCOPE) && certainlyOverlaps(jted, ZIP_SCOPE), "a Send in 85635 places both");
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
