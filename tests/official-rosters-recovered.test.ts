import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseRecoveredLegislature } from "../lib/sources/official-rosters/recovered-states.ts";

const root = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("research-recovered.json", root), "utf8")) as {
  id: string; url: string; retrievedAt?: string; fixture?: string;
}[];
function document(id: string) {
  const evidence = manifest.find(row => row.id === id)!;
  return { url: evidence.url, retrievedAt: evidence.retrievedAt,
    body: gunzipSync(readFileSync(new URL(evidence.fixture!, root))).toString("utf8") };
}

test("the Alabama official public query enumerates both chambers without legislative staff", () => {
  const parsed = parseRecoveredLegislature("AL", document("al-elected-json"))!;
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.filter(row => row.chamber === "lower").length, 105);
  assert.equal(parsed.records.filter(row => row.chamber === "upper").length, 35);
  assert.equal(parsed.records.some(row => row.name === "Will Ainsworth"), false);
  assert.deepEqual(parsed.records[0], { name: "Greg Albritton", district: "22", chamber: "upper",
    nativeId: "100465", sourceUrl: "https://alison.legislature.state.al.us/graphql", party: "R" });
});

test("South Dakota uses native person IDs and the publisher's explicit district", () => {
  const parsed = parseRecoveredLegislature("SD", document("sd-roster-json"))!;
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.length, 105);
  assert.equal(parsed.records[0]!.name, "Andera, Bobbi L.");
  assert.equal(parsed.records[0]!.district, "10");
  assert.equal(parsed.records[0]!.nativeId, "23316");
  assert.equal(parsed.records[0]!.sourceUrl, "https://sdlegislature.gov/Legislators/Profile/4731");
});

test("Vermont's current roster excludes every source-marked 2024-2026 resignation", () => {
  const parsed = parseRecoveredLegislature("VT", document("vt-roster-json"))!;
  assert.equal(parsed.records.length, 180);
  assert.equal(parsed.records.filter(row => row.chamber === "lower").length, 150);
  assert.equal(parsed.records.filter(row => row.chamber === "upper").length, 30);
  for (const departed of ["Samuel Douglass", "Larry Hart", "Mari Cordes", "Jim Harrison", "Robert Hooper", "Casey Toof"]) {
    assert.equal(parsed.records.some(row => row.name === departed), false, `${departed} has an explicit published departure`);
  }
  assert.equal(parsed.records[0]!.name, "Philip Baruth");
  assert.equal(parsed.records[0]!.district, "Chittenden-Central");
  assert.equal(parsed.records[0]!.nativeId, "15791");
});

test("Wyoming uses the current year roster, including native IDs and source H/S district prefixes", () => {
  for (const [id, chamber, count] of [["wy-house-proxy", "lower", 62], ["wy-senate-proxy", "upper", 31]] as const) {
    const parsed = parseRecoveredLegislature("WY", document(id), chamber)!;
    assert.equal(parsed.complete, true);
    assert.equal(parsed.records.length, count);
    assert.deepEqual(parsed.chambers, [chamber]);
    assert.equal(parsed.records.every(row => row.chamber === chamber && /^\d+$/.test(row.district)), true);
  }
  const first = parseRecoveredLegislature("WY", document("wy-house-proxy"), "lower")!.records[0]!;
  assert.equal(first.name, "Steve Harshman");
  assert.equal(first.nativeId, "717");
  assert.equal(first.district, "37");
});

test("Michigan's official embedded senatorInfo data enumerates all senators", () => {
  const parsed = parseRecoveredLegislature("MI", document("mi-senate-all"), "upper")!;
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.length, 38);
  assert.equal(parsed.records[0]!.name, "Thomas A Albert");
  assert.equal(parsed.records[0]!.nativeId, "12647");
  assert.equal(parsed.records[0]!.district, "18");
});

test("a source schema change cannot silently omit an Alabama seat", () => {
  const source = document("al-elected-json");
  const payload = JSON.parse(source.body);
  payload.data.legislativeMembers.data[0].district = null;
  assert.throws(() => parseRecoveredLegislature("AL", { ...source, body: JSON.stringify(payload) }), /district/);
});

test("Montana's contaminated 2025-2026 response cannot publish future legislature assignments", () => {
  assert.throws(() => parseRecoveredLegislature("MT", document("mt-session2-json")), /future legislature/);
});

test("Rhode Island reads every SOAP list item and excludes all source-marked inactive holders", () => {
  const parsed = parseRecoveredLegislature("RI", document("ri-soap-both"))!;
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.filter(row => row.chamber === "lower" && !row.vacant).length, 74);
  assert.equal(parsed.records.filter(row => row.chamber === "upper").length, 38);
  assert.equal(parsed.records.some(row => row.nativeId === "1420"), false);
  assert.equal(parsed.records.some(row => row.nativeId === "1535"), true);
  assert.deepEqual(parsed.records.filter(row => row.vacant), [{ name: "Vacant", district: "31", chamber: "lower",
    sourceUrl: "https://www.rilegislature.gov/_vti_bin/Lists.asmx", vacant: true, since: null, seatBound: true }]);
  assert.equal(parsed.records[0]!.name, "Stefano V. Famiglietti");
  assert.equal(parsed.records[0]!.district, "4");
  assert.equal(parsed.records[0]!.nativeId, "1381");
  assert.equal(parsed.records[0]!.sourceUrl, "https://www.rilegislature.gov/senators/famiglietti/Pages/Biography.aspx");
});
