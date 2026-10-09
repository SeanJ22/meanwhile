import assert from "node:assert/strict";
import test from "node:test";
import { zip, buildWorkbook } from "../scripts/xlsx.mjs";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import { readXlsxSheets } from "../lib/census-geography/xlsx.ts";
import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { selectGeographyVersion } from "../lib/census-geography/selection.ts";
import type { GeographyRef } from "../lib/census-geography/contract.ts";

function boundary(deleted = false): Buffer {
  const polygon = Buffer.alloc(128); polygon.writeInt32LE(5, 0);
  polygon.writeDoubleLE(1, 20); polygon.writeDoubleLE(1, 28);
  polygon.writeInt32LE(1, 36); polygon.writeInt32LE(5, 40); polygon.writeInt32LE(0, 44);
  [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].forEach(([x, y], index) => { polygon.writeDoubleLE(x, 48 + index * 16); polygon.writeDoubleLE(y, 56 + index * 16); });
  const shp = Buffer.alloc(100 + 12 + 8 + polygon.length); shp.writeInt32BE(shp.length / 2, 24);
  shp.writeInt32BE(1, 100); shp.writeInt32BE(2, 104); shp.writeInt32LE(0, 108);
  shp.writeInt32BE(2, 112); shp.writeInt32BE(polygon.length / 2, 116); polygon.copy(shp, 120);
  const dbf = Buffer.alloc(65 + 2 * 11, 32); dbf.writeUInt32LE(2, 4); dbf.writeUInt16LE(65, 8); dbf.writeUInt16LE(11, 10);
  dbf.fill(0, 32, 64); dbf.write("NAME", 32); dbf[48] = 10; dbf[64] = 13;
  dbf.write("EMPTY", 66); dbf.write("CORRECT", 77); if (deleted) dbf[76] = 42;
  return zip([{ name: "a.shp", data: shp }, { name: "a.dbf", data: dbf }], "2026-10-01");
}

test("null shapes and deleted DBF rows preserve ordinal identity", () => {
  const parsed = readBoundaryZip(boundary());
  assert.equal(parsed.features.length, 1);
  assert.equal(parsed.features[0].properties.NAME, "CORRECT");
  assert.equal(readBoundaryZip(boundary(true)).features.length, 0);
});

test("every named workbook sheet is parsed, including dependent systems", () => {
  const bytes = buildWorkbook([
    { name: "General Purpose", header: ["PID6", "UNIT_NAME"], rows: [["00123", "A County"]], widths: [10, 20] },
    { name: "DEP School Dist", header: ["PID6", "UNIT_NAME"], rows: [["00456", "A School"]], widths: [10, 20] },
  ], "2026-10-01");
  const sheets = [...readXlsxSheets(bytes)].map(sheet => ({ name: sheet.name, rows: [...sheet.rows] }));
  assert.deepEqual(sheets.map(sheet => sheet.name), ["General Purpose", "DEP School Dist"]);
  assert.deepEqual(sheets[1].rows[1], ["00456", "A School"]);
});

test("alphanumeric legislative codes survive while unassigned codes do not become districts", () => {
  const base: GeographyRef = { type: "state_leg_upper", version: "sldu:2024", ocdId: null, geoid: "02A", stateFips: "02", stateAbbr: "AK", label: "Senate A", memberStates: ["AK"] };
  assert.equal(censusWorkDivision(base), "ocd-division/country:us/state:ak/sldu:a");
  assert.equal(censusWorkDivision({ ...base, geoid: "02ZZZ" }), null);
});

test("a serving term, a documented general election and an incomplete release stay distinct", () => {
  const versions = [{ key: "cd:119", type: "congressional_district" as const }, { key: "cd:120", type: "congressional_district" as const }];
  assert.equal(selectGeographyVersion(versions, "congressional_district", { purpose: "representation", asOf: "2026-10-09" })?.key, "cd:119");
  assert.equal(selectGeographyVersion(versions, "congressional_district", { purpose: "election", asOf: "2026-10-09", electionDate: "2026-11-03" })?.key, "cd:120");
  assert.equal(selectGeographyVersion(versions, "congressional_district", { purpose: "election", asOf: "2026-10-09", electionDate: "2026-06-01" }), null);
  assert.equal(selectGeographyVersion(versions.map(row => ({ ...row, retrievalComplete: false })), "congressional_district", { purpose: "representation", asOf: "2026-10-09" }), null);
});
