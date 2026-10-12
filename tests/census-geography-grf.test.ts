import assert from "node:assert/strict";
import test from "node:test";

import { GRF_CD120, GrfAccumulator, parseGrfHeader, resolveGrfColumns } from "../lib/census-geography/grf.ts";
import type { GeographyVersion } from "../lib/census-geography/contract.ts";

const HEADER = "TABBLKST|TABBLKCOU|ZCTA5CE|CDDECFP|CDCURFP|SLDUST|SLDLST|AREALAND";
const VER: GeographyVersion = {
  key: "cd:120", type: "congressional_district", plan: "120th Congress", zctaTabulation: "2020",
  effectiveFor: "test",
  provenance: { sourceUrls: [], sourceDataset: "TEST", sourceFiles: [], sourceChecksums: [], method: "test", computedAt: "2026-09-22" },
};

test("grf: aggregates ZCTA↔CDCURFP overlaps by block land (whole vs partial), skips water/unassigned", () => {
  const acc = new GrfAccumulator(GRF_CD120, resolveGrfColumns(parseGrfHeader(HEADER), "CDCURFP"));
  acc.add("06|001|90001|30|37|020|045|100".split("|")); // 90001 wholly in CA-37
  acc.add("06|001|90002|30|37|020|045|60".split("|"));  // 90002 60% in CA-37
  acc.add("06|001|90002|31|38|021|046|40".split("|"));  // 90002 40% in CA-38 (split, never collapsed)
  acc.add("06|001||30|37|020|045|0".split("|"));        // water block, blank ZCTA -> skipped
  acc.add("06|001|90003|30|ZZ|020|045|50".split("|"));  // ZCTA in no CD of this layer (ZZ)
  acc.add("02|170|99501|00|00|001|001|500".split("|")); // AK at-large

  const stats = acc.stats();
  assert.equal(stats.blocks, 6);

  const scope = acc.finish(VER);
  assert.equal(scope.type, "congressional_district");
  assert.equal(scope.version, "cd:120");
  assert.equal(scope.fractionBasis, "area");

  const ca37 = scope.groupings.find((g) => g.geoid === "0637")!;
  assert.equal(ca37.stateAbbr, "CA");
  assert.match(ca37.label, /CA Congressional District 37 \(120th Congress\)/);
  const whole = ca37.overlaps.find((o) => o.zcta5 === "90001")!;
  assert.equal(whole.whole, true);
  assert.equal(whole.fraction, 1);
  const partial = ca37.overlaps.find((o) => o.zcta5 === "90002")!;
  assert.equal(partial.whole, false);
  assert.equal(partial.fraction, 0.6);

  const ca38 = scope.groupings.find((g) => g.geoid === "0638")!;
  assert.equal(ca38.overlaps.find((o) => o.zcta5 === "90002")!.fraction, 0.4);

  // A ZCTA whose blocks are all ZZ appears in no CD grouping (never a false zero).
  assert.ok(!scope.groupings.some((g) => g.overlaps.some((o) => o.zcta5 === "90003")));

  const ak = scope.groupings.find((g) => g.geoid === "0200")!;
  assert.match(ak.label, /AK Congressional District \(At Large\) \(120th Congress\)/);
});

test("grf: a header missing a needed column fails loudly", () => {
  assert.throws(
    () => resolveGrfColumns(parseGrfHeader("TABBLKST|ZCTA5CE|AREALAND"), "CDCURFP"),
    /missing column "CDCURFP"/,
  );
});
