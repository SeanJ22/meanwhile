/**
 * The Census-geography ZCTA-overlap importer and read model.
 *
 * `build.ts` parses Census tab20 relationship files into overlap scopes;
 * `lookup.ts` serves the Admin contract over a built dataset. The read-model
 * assertions run against the committed AZ bootstrap fixture, and the AZ-06 =
 * 79-ZCTA figure is the verified Census tab20 CD119 result (zccd.csv's 87
 * differs by 8 ZCTAs the HUD ZIP crosswalk adds — a method difference, not a
 * coverage gap; see docs/census-geography.md).
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { ScopeAccumulator, parseTab20Header, resolveTab20Columns } from "../lib/census-geography/build.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import type { GeographyVersion } from "../lib/census-geography/contract.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";

const CD_HEADER =
  "OID_CD119_20|GEOID_CD119_20|NAMELSAD_CD119_20|AREALAND_CD119_20|AREAWATER_CD119_20|MTFCC_CD119_20|FUNCSTAT_CD119_20|" +
  "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|" +
  "AREALAND_PART|AREAWATER_PART";

const VERSION_META: GeographyVersion = {
  key: "cd:119",
  type: "congressional_district",
  plan: "119th Congress",
  zctaTabulation: "2020",
  effectiveFor: "test",
  provenance: { sourceUrls: [], sourceDataset: "TEST", sourceFiles: [], sourceChecksums: [], method: "test", computedAt: "2026-09-21" },
};

test("build: parses whole/partial overlaps, skips the no-ZCTA remainder, keeps split relationships", () => {
  const cols = resolveTab20Columns(parseTab20Header(CD_HEADER), "CD119_20");
  const acc = new ScopeAccumulator(
    { type: "congressional_district", version: "cd:119", geoTag: "CD119_20", labelSuffix: "(119th Congress)" },
    cols,
  );
  // remainder row: CD present, ZCTA blank -> skipped
  acc.add("2|0401|Congressional District 1|1000|0|G5200|N|||||||||500|0".split("|"));
  // whole: ZCTA 85001 lies entirely in 0401
  acc.add("2|0401|Congressional District 1|1000|0|G5200|N|9|85001|ZCTA5 85001|100|0|G6350|B5|S|100|0".split("|"));
  // split: ZCTA 85002 is 25% in 0401, 75% in 0402 (never collapsed, never doubled)
  acc.add("2|0401|Congressional District 1|1000|0|G5200|N|9|85002|ZCTA5 85002|200|0|G6350|B5|S|50|0".split("|"));
  acc.add("2|0402|Congressional District 2|1000|0|G5200|N|9|85002|ZCTA5 85002|200|0|G6350|B5|S|150|0".split("|"));

  const stats = acc.stats();
  assert.equal(stats.skippedBlank, 1, "the no-ZCTA remainder row must be skipped");
  assert.equal(stats.geographies, 2);

  const scope = acc.finish(VERSION_META);
  assert.equal(scope.instanceCount, 2);
  assert.equal(scope.zctaEdgeCount, 3);
  assert.equal(scope.fractionBasis, "area");

  const d1 = scope.groupings.find((g) => g.geoid === "0401")!;
  assert.equal(d1.stateFips, "04");
  assert.equal(d1.stateAbbr, "AZ");
  assert.match(d1.label, /AZ Congressional District 1 \(119th Congress\)/);
  const whole = d1.overlaps.find((o) => o.zcta5 === "85001")!;
  assert.equal(whole.whole, true);
  assert.equal(whole.fraction, 1);
  const partial = d1.overlaps.find((o) => o.zcta5 === "85002")!;
  assert.equal(partial.whole, false);
  assert.equal(partial.fraction, 0.25);

  const d2 = scope.groupings.find((g) => g.geoid === "0402")!;
  assert.equal(d2.overlaps.find((o) => o.zcta5 === "85002")!.fraction, 0.75);
});

test("build: a header missing a needed column fails loudly", () => {
  assert.throws(() => resolveTab20Columns(parseTab20Header("GEOID_ZCTA5_20|AREALAND_PART"), "CD119_20"), /missing column "GEOID_CD119_20"/);
});

function azLookup() {
  const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
  return createLookup(dataset, "bootstrap:az");
}

test("lookup: enumerates Arizona's 9 congressional districts", async () => {
  const cds = await azLookup().enumerateGroupings("congressional_district");
  assert.equal(cds.status.kind, "OK");
  assert.equal(cds.count, 9);
  assert.ok(cds.instances.every((r) => r.stateAbbr === "AZ" && r.type === "congressional_district"));
});

test("lookup: AZ-06 returns 79 ZCTAs (verified Census tab20 CD119), stated N == rows", async () => {
  const res = await azLookup().zctasForGrouping({ type: "congressional_district", geoid: "0406", version: "cd:119" });
  assert.equal(res.status.kind, "OK");
  assert.equal(res.count, 79);
  assert.equal(res.count, res.overlaps.length);
  assert.ok(res.overlaps.some((o) => o.whole), "expected some wholly-contained ZCTAs");
  assert.ok(res.overlaps.some((o) => !o.whole), "expected some partly-overlapping ZCTAs");
  for (const o of res.overlaps) {
    assert.ok(o.fraction === null || (o.fraction >= 0 && o.fraction <= 1), `fraction out of range for ${o.zcta5}`);
  }
});

test("lookup: reverse ZCTA -> groupings spans the parallel types, never nested", async () => {
  const l = azLookup();
  const az06 = await l.zctasForGrouping({ type: "congressional_district", geoid: "0406", version: "cd:119" });
  const sample = az06.overlaps[0].zcta5;
  const rev = await l.groupingsForZcta(sample);
  assert.equal(rev.status.kind, "OK");
  const types = new Set(rev.memberships.map((m) => m.geography.type));
  assert.ok(types.has("congressional_district"));
  assert.ok(types.has("county"), "a ZCTA is in a county independently of its district");
});

test("lookup: unknown ZCTA and unknown geography are typed absence, never zero", async () => {
  const l = azLookup();
  const rev = await l.groupingsForZcta("99999");
  assert.equal(rev.status.kind, "NOT_IN_COVERAGE");
  const badVer = await l.zctasForGrouping({ type: "congressional_district", geoid: "0406", version: "cd:120" });
  assert.equal(badVer.status.kind, "NOT_YET_PUBLISHED");
});

test("lookup: postal reconciliation distinguishes a ZCTA from a non-ZCTA ZIP", async () => {
  const l = azLookup();
  const az06 = await l.zctasForGrouping({ type: "congressional_district", geoid: "0406", version: "cd:119" });
  const realZcta = az06.overlaps[0].zcta5;
  const [good, bad] = await l.reconcilePostalZips([realZcta, "00000"]);
  assert.equal(good.isZcta, true);
  assert.equal(good.outsideCoverageReason, null);
  assert.equal(bad.isZcta, false);
  assert.equal(bad.outsideCoverageReason, "not_a_census_zcta");
});
