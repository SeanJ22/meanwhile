import assert from "node:assert/strict";
import test from "node:test";
import { zip, buildWorkbook } from "../scripts/xlsx.mjs";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import { readXlsxFileSheets } from "../lib/census-geography/xlsx.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { censusWorkDivision, districtFamilyKey } from "../lib/census-geography/division-id.ts";
import { applicabilityOf, selectGeographyVersion } from "../lib/census-geography/selection.ts";
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

test("every named workbook sheet is parsed, including dependent systems", async () => {
  const bytes = buildWorkbook([
    { name: "General Purpose", header: ["PID6", "UNIT_NAME"], rows: [["00123", "A County"]], widths: [10, 20] },
    { name: "DEP School Dist", header: ["PID6", "UNIT_NAME"], rows: [["00456", "A School"]], widths: [10, 20] },
  ], "2026-10-01");
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-xlsx-test-"));
  const sheets: { name: string; rows: string[][] }[] = [];
  try {
    const path = join(directory, "source.xlsx"); await writeFile(path, bytes);
    for await (const sheet of readXlsxFileSheets(path)) { const rows: string[][] = []; for await (const row of sheet.rows) rows.push(row); sheets.push({ name: sheet.name, rows }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
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
  assert.equal(selectGeographyVersion(versions, "congressional_district", { purpose: "election", asOf: "2026-10-09", electionDate: "2026-06-01" }, "AZ")?.key, "cd:119");
  assert.equal(selectGeographyVersion(versions.map(row => ({ ...row, retrievalComplete: false })), "congressional_district", { purpose: "representation", asOf: "2026-10-09" }), null);
});

test("open plans hold until a complete successor's same-purpose interval begins; equal starts stay ambiguous", () => {
  const old = { key: "sldu:future-a", type: "state_leg_upper" as const, applicability: [{ purpose: "election" as const, from: "2028-11-07" }] };
  const newer = { ...old, key: "sldu:future-b", applicability: [{ purpose: "election" as const, from: "2030-11-05" }] };
  const election = { purpose: "election" as const, asOf: "2030-10-01", electionDate: "2030-11-05" };
  assert.equal(selectGeographyVersion([old, newer], old.type, { ...election, electionDate: "2030-11-04" }, "AZ")?.key, old.key);
  assert.equal(selectGeographyVersion([old, newer], old.type, election, "AZ")?.key, newer.key);
  assert.equal(selectGeographyVersion([old, { ...newer, retrievalComplete: false }], old.type, election, "AZ")?.key, old.key);
  assert.equal(selectGeographyVersion([old, { ...newer, applicability: old.applicability }], old.type, election, "AZ"), null);
  const representation = { ...newer, applicability: [{ purpose: "representation" as const, from: "2029-01-01" }] };
  assert.equal(selectGeographyVersion([old, representation], old.type, election, "AZ")?.key, old.key);
});

test("known plan applicability corrects stale metadata, with exclusions only when a state is supplied", () => {
  const stale = { key: "sldu:2024", type: "state_leg_upper" as const, applicability: [{ purpose: "representation" as const, from: "2025-01-01", through: "2027-01-01" }] };
  const election = { purpose: "election" as const, asOf: "2026-10-12", electionDate: "2026-11-03" };
  assert.ok(applicabilityOf(stale).some(interval => interval.purpose === "election"));
  assert.equal(selectGeographyVersion([stale], stale.type, election, "az")?.key, stale.key);
  assert.equal(selectGeographyVersion([stale], stale.type, election, "mi"), null);
  assert.equal(selectGeographyVersion([stale], stale.type, election)?.key, stale.key);
  assert.equal(districtFamilyKey("ocd-division/country:us/state:az/sldu:20"), "az/sldu");
  assert.equal(districtFamilyKey("ocd-division/country:us/state:az/place:tucson"), null);
});

test("a held 2026 successor replaces the prior plan's continuation when the new representation term starts", () => {
  for (const [type, prior, next] of [
    ["congressional_district", "cd:119", "cd:120"],
    ["state_leg_upper", "sldu:2024", "sldu:2026"],
    ["state_leg_lower", "sldl:2024", "sldl:2026"],
  ] as const) {
    const versions = [{ key: prior, type }, { key: next, type }];
    const serving = { purpose: "representation" as const, asOf: "2027-03-01" };
    assert.equal(selectGeographyVersion(versions, type, serving, "AZ")?.key, next);
    assert.equal(selectGeographyVersion([{ key: prior, type }], type, serving, "AZ")?.key, prior);
    assert.equal(selectGeographyVersion([versions[0], { ...versions[1], retrievalComplete: false }], type, serving, "AZ")?.key, prior);
  }
});
