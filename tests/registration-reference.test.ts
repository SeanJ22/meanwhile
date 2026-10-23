import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseCsv } from "../lib/reference/index.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";

/**
 * Registration without per-state code reads this reference. These pin what it
 * promises: every Census of Governments row sits in exactly one state's file;
 * a government pairs to a division by Census code wherever the Census gives
 * one, and otherwise by a school district's name or not at all, with the
 * reason written; its jurisdiction id is the operational reference's own; and
 * a government the committed registry already knows lands on the id the
 * registry keys, directly or through its alternate.
 */

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "data", "derived", "registration");

type Government = [pid6: string, jurisdictionId: string, name: string, govType: string, division: number, how: string, alternate: number];
interface StateFile {
  readonly formatVersion: number;
  readonly state: string;
  readonly functionalStatus?: { readonly dataset: string; readonly sha256: string; readonly sources: Readonly<Record<string, string>> };
  readonly divisions: readonly [ocdId: string, layer: string, geoid: string, censusName: string, lsad?: string, funcstat?: string, classfp?: string][];
  readonly governments: readonly Government[];
}
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as {
  readonly counts: { readonly states: number; readonly governments: number; readonly placedByStateFipsForABlankPostalCode: number; readonly byTypeAndPairing: Readonly<Record<string, number>> };
  readonly states: Readonly<Record<string, { readonly sha256: string; readonly divisions: number; readonly governments: number; readonly paired: number; readonly generatedAt: string }>>;
};
const FUNCSTAT_EXTRACT = "data/reference/census_tiger_2023_territory_functional_status.csv";
const TERRITORIES = ["as", "gu", "mp", "pr", "vi"];
const GOVERNING = new Set(["A", "B", "C", "G"]);
const states = new Map<string, StateFile>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  states.set(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, file), "utf8")) as StateFile);
}
/** The one id the committed geometry already gives two governments (the ZIP index names it too). */
const inherited = new Set(Object.keys((JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-divisions", "index.json"), "utf8")) as { inheritedSharedIds: Record<string, unknown> }).inheritedSharedIds));
const PAIRED = new Set(["STATE", "COUNTY_FIPS", "PLACE_FIPS", "COUSUB_FIPS", "SCHOOL_NAME", "SCHOOL_NAME_LOOSE", "CONSOLIDATED_COUNTY_FIPS", "TIGER_FUNCSTAT",
  "BOUNDARY_SOURCE", "BOUNDARY_SOURCE_ONLY", "COUNTY_NAMED", "AIANNH_CODE"]);
/** Rows read from a district's own boundary layer or the Census AIANNH list, not from the Census of Governments. */
const ADDED = new Set(["BOUNDARY_SOURCE_ONLY", "AIANNH_CODE"]);
const UNPAIRED = new Set(["NO_CENSUS_GEOGRAPHY", "NO_CENSUS_SCHOOL_GEOGRAPHY", "NO_DIVISION_FOR_FIPS", "NO_OCD_ID_FOR_DIVISION", "SCHOOL_NAME_AMBIGUOUS", "SCHOOL_NAME_NOT_FOUND", "STATE_CODES_DISAGREE"]);

function censusRows(path: string): number {
  const [header, ...rows] = parseCsv(readFileSync(join(ROOT, path), "utf8"));
  return rows.filter((r) => r.length >= header.length).length;
}
function government(state: string, name: string): { readonly row: Government; readonly division: string | null; readonly alternate: string | null } {
  const s = states.get(state)!;
  const row = s.governments.find((g) => g[2] === name);
  assert.ok(row, `${state}: ${name} is in the reference`);
  return { row, division: row[4] >= 0 ? s.divisions[row[4]][0] : null, alternate: row[6] >= 0 ? s.divisions[row[6]][0] : null };
}

test("every Census government sits in exactly one state's file, every file is what the index says, and every row pairs or says why not", () => {
  const census = censusRows("data/reference/census_govt_units_2022.csv") + censusRows("data/reference/census_govt_units_2022_dependent_school_systems.csv");
  assert.equal(states.size, index.counts.states);
  assert.equal(states.size, 56, "every state, DC and the territories the Census files carry");
  const governments = [...states.values()].reduce((n, s) => n + s.governments.length, 0);
  const territoryGovernments = [...states.values()].reduce((n, s) => n + s.governments.filter((g) => g[5] === "TIGER_FUNCSTAT").length, 0);
  const added = [...states.values()].reduce((n, s) => n + s.governments.filter((g) => ADDED.has(g[5])).length, 0);
  assert.equal(governments - added, census + states.size + territoryGovernments, "each Census row once, plus each state itself, plus each territory government TIGER/Line records");
  assert.equal(index.counts.governments, governments);
  assert.equal(index.counts.placedByStateFipsForABlankPostalCode, 13, "13 Texas special districts carry FIPS 48 and no postal code, and are placed by name of it");

  const pids = new Set<string>();
  for (const [code, s] of states) {
    const text = readFileSync(join(DIR, `${code}.json`), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), index.states[code].sha256, `${code}.json matches its recorded sha256`);
    assert.equal(s.divisions.length, index.states[code].divisions);
    assert.equal(s.divisions[0][1], "state", `${code}: the state itself is its first division`);
    const ids = s.divisions.map((d) => d[0]);
    const repeated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    for (const id of repeated) assert.ok(inherited.has(id), `${code}: ${id} names two divisions, and only an id the committed geometry already shares may`);
    for (const g of s.governments) {
      assert.ok(PAIRED.has(g[5]) || UNPAIRED.has(g[5]), `${code}: ${g[2]} carries a known pairing or reason (${g[5]})`);
      assert.equal(g[4] >= 0, PAIRED.has(g[5]), `${code}: ${g[2]} has a division exactly when it paired`);
      assert.ok(g[4] < s.divisions.length && g[6] < s.divisions.length, `${code}: ${g[2]}'s division references are in range`);
      if (g[4] >= 0) assert.doesNotMatch(s.divisions[g[4]][3], /not defined/i, `${code}: ${g[2]} never pairs to TIGER's "not defined" placeholder`);
      // A tribal area reaching several states is listed in each.
      if (g[0] !== "state" && g[5] !== "AIANNH_CODE") {
        assert.ok(!pids.has(g[0]), `Census id ${g[0]} appears once nationally`);
        pids.add(g[0]);
      }
    }
  }
});

test("held school rows publish independently without inheriting a name-based geographic association", () => {
  const nh = referenceGovernmentListings(loadRegistrationReference(ROOT, "NH"));
  assert.ok(nh.some(row => row.kind === "DEPENDENT_SCHOOL_SYSTEM"));
  assert.ok(nh.some(row => row.kind === "EDUCATION_AGENCY"));
  assert.ok(nh.filter(row => row.governmentClass.includes("SCHOOL")).every(row => row.associations.length === 0));
  assert.ok(nh.filter(row => row.governmentClass === "COUNTY").every(row => row.associations.length));
});

test("a government the committed registry knows lands on the id it keys, directly or through its alternate", () => {
  assert.equal(government("nj", "COUNTY OF MORRIS").division, "ocd-division/country:us/state:nj/county:morris");
  assert.equal(government("nj", "TOWNSHIP OF ROCKAWAY").division, "ocd-division/country:us/state:nj/county:morris/place:rockaway_township");
  const borough = government("nj", "BOROUGH OF ROCKAWAY");
  assert.equal(borough.division, "ocd-division/country:us/state:nj/county:morris/place:rockaway_borough", "a strong-MCD state's borough is its county subdivision");
  assert.equal(borough.alternate, "ocd-division/country:us/state:nj/place:rockaway", "and carries its place as the alternate");
  assert.equal(government("az", "CITY OF TUCSON").division, "ocd-division/country:us/state:az/place:tucson");
  const concord = government("nh", "CITY OF CONCORD");
  assert.equal(concord.alternate, "ocd-division/country:us/state:nh/place:concord", "the reviewed registry keys Concord's council on its place, which the alternate carries");
  assert.equal(government("nh", "TOWN OF NEWBURY").division, "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town");

  // Outside the three registered states, where nothing was paired before.
  assert.equal(government("oh", "COUNTY OF FRANKLIN").division, "ocd-division/country:us/state:oh/county:franklin");
  const columbus = government("oh", "CITY OF COLUMBUS");
  assert.equal(columbus.division, "ocd-division/country:us/state:oh/place:columbus");
  assert.equal(columbus.row[1], "oh:city:city-of-columbus");
});

test("a county location and a consolidated name never become service geography", () => {
  const tn = referenceGovernmentListings(loadRegistrationReference(ROOT, "TN"));
  const government = tn.find(row => row.name === "METROPOLITAN GOVERNMENT OF NASHVILLE-DAVIDSON COUNTY")!;
  assert.ok(government);
  assert.deepEqual(government.associations, []);
  assert.ok(government.nativeIds.census_pid6);
});

test("a territory's governments are exactly its divisions TIGER/Line gives a governing status, read from the committed extract", () => {
  const extract = readFileSync(join(ROOT, FUNCSTAT_EXTRACT), "utf8");
  const [header, ...rows] = parseCsv(extract).filter((r) => r.length > 1);
  const status = new Map(rows.map((r) => [`${r[header.indexOf("layer")]}:${r[header.indexOf("geoid")]}`, r[header.indexOf("funcstat")]]));
  const expected: Record<string, number> = { as: 94, gu: 0, mp: 4, pr: 78, vi: 0 };
  for (const code of TERRITORIES) {
    const s = states.get(code)!;
    assert.equal(s.functionalStatus?.dataset, FUNCSTAT_EXTRACT, `${code}: its governments' source is named`);
    assert.equal(s.functionalStatus?.sha256, createHash("sha256").update(extract).digest("hex"), `${code}: and bound to the committed extract's bytes`);
    const governing: number[] = [];
    s.divisions.forEach((d, i) => {
      if (d[1] !== "county" && d[1] !== "cousub" && d[1] !== "place") return;
      assert.equal(d.length, 7, `${code}: ${d[0]} carries LSAD, FUNCSTAT and CLASSFP`);
      assert.equal(d[5], status.get(`${d[1]}:${d[2]}`), `${code}: ${d[0]}'s status is the extract's`);
      if (GOVERNING.has(d[5]!)) governing.push(i);
    });
    const rowsFromStatus = s.governments.filter((g) => g[5] === "TIGER_FUNCSTAT");
    assert.deepEqual(rowsFromStatus.map((g) => g[4]).sort((a, b) => a - b), governing, `${code}: one government per governing division, and none elsewhere`);
    assert.equal(rowsFromStatus.length, expected[code], `${code}: ${expected[code]} governments`);
    for (const g of rowsFromStatus) {
      assert.equal(g[2], s.divisions[g[4]][3], `${code}: ${g[0]} keeps the Census legal name`);
      assert.equal(g[0], `${s.divisions[g[4]][1]}:${s.divisions[g[4]][2]}`, `${code}: its Census id is its division's layer and GEOID`);
    }
    // The Census of Governments lists nothing here, and the territory itself is never a government row beyond its STATE line.
    assert.deepEqual(s.governments.filter((g) => g[5] !== "TIGER_FUNCSTAT").map((g) => g[3]), ["STATE"], `${code}: no other government row`);
  }
  // A state's divisions carry no status: nothing is read for them, so nothing is claimed.
  for (const [code, s] of states) if (!TERRITORIES.includes(code)) assert.ok(s.functionalStatus === undefined && s.divisions.every((d) => d.length === (d[1] === "district" ? 5 : 4)), `${code}: no functional status`);
  assert.equal(government("pr", "Adjuntas Municipio").division, "ocd-division/country:us/territory:pr/county:adjuntas");
  assert.equal(government("as", "Aasu village").division, "ocd-division/country:us/territory:as/place:aasu");
});

test("a rebuild leaves an unchanged state's build date alone, so its records do not move", async () => {
  const { loadRegistrationReference } = await import("../lib/registration/reference.ts");
  for (const code of states.keys()) {
    assert.equal(loadRegistrationReference(ROOT, code).generatedAt, index.states[code].generatedAt, `${code}: its records carry its own file's date`);
  }
});
