import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseCsv } from "../lib/reference/index.ts";

/**
 * **EVERY STATE'S GOVERNMENTS, PAIRED TO THEIR DIVISIONS — AND NOTHING
 * GUESSED.** (2026-09-23; `scripts/build-registration-reference.mts`.)
 *
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
  readonly divisions: readonly [ocdId: string, layer: string, geoid: string, censusName: string][];
  readonly governments: readonly Government[];
}
const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as {
  readonly counts: { readonly states: number; readonly governments: number; readonly placedByStateFipsForABlankPostalCode: number; readonly byTypeAndPairing: Readonly<Record<string, number>> };
  readonly states: Readonly<Record<string, { readonly sha256: string; readonly divisions: number; readonly governments: number; readonly paired: number }>>;
};
const states = new Map<string, StateFile>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  states.set(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, file), "utf8")) as StateFile);
}
/** The one id the committed geometry already gives two governments (the ZIP index names it too). */
const inherited = new Set(Object.keys((JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-divisions", "index.json"), "utf8")) as { inheritedSharedIds: Record<string, unknown> }).inheritedSharedIds));
const PAIRED = new Set(["STATE", "COUNTY_FIPS", "PLACE_FIPS", "COUSUB_FIPS", "SCHOOL_NAME", "SCHOOL_NAME_LOOSE"]);
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
  assert.equal(governments, census + states.size, "each Census row once, plus each state itself");
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
      if (g[0] !== "state") {
        assert.ok(!pids.has(g[0]), `Census id ${g[0]} appears once nationally`);
        pids.add(g[0]);
      }
    }
  }
});

test("a government pairs by Census code wherever the Census gives one, and nothing it does not tie to a place is guessed", () => {
  const t = index.counts.byTypeAndPairing;
  assert.equal(t["COUNTY:COUNTY_FIPS"], 3031, "every county, by state and county code");
  assert.equal(t["SPECIAL DISTRICT:NO_CENSUS_GEOGRAPHY"], 39555, "no special district has Census geography, so none is paired");
  assert.equal((t["MUNICIPAL:PLACE_FIPS"] ?? 0) + (t["MUNICIPAL:COUSUB_FIPS"] ?? 0), 19466, "19,466 of 19,491 municipalities by code");
  assert.equal(t["TOWNSHIP:COUSUB_FIPS"], 16171, "16,171 of 16,214 townships by county-subdivision code");
  assert.equal(
    (t["MUNICIPAL:STATE_CODES_DISAGREE"] ?? 0) + (t["TOWNSHIP:STATE_CODES_DISAGREE"] ?? 0) + (t["SCHOOL DISTRICT:STATE_CODES_DISAGREE"] ?? 0),
    43,
    "a row whose postal state and state code name two states is named, never paired across states",
  );
  // A school district has no Census code in the file; it pairs by name, or says it could not.
  const schools = Object.entries(t).filter(([k]) => k.startsWith("SCHOOL DISTRICT:")).reduce((n, [, v]) => n + v, 0);
  assert.equal(schools, 12546);
  assert.ok((t["SCHOOL DISTRICT:SCHOOL_NAME"] ?? 0) + (t["SCHOOL DISTRICT:SCHOOL_NAME_LOOSE"] ?? 0) > 9900, "most school districts pair by name");
});

test("the jurisdiction ids are the operational reference's own, collision suffixes included", () => {
  for (const code of ["az", "nh", "nj"]) {
    const reference = JSON.parse(readFileSync(join(ROOT, "data", "states", code, "jurisdictions", `${code}.json`), "utf8")) as { jurisdictions: { id: string; name: string }[] };
    const mine = new Map(states.get(code)!.governments.map((g) => [g[1], g[2]]));
    assert.equal(mine.size, reference.jurisdictions.length, `${code}: one row per jurisdiction`);
    for (const j of reference.jurisdictions) assert.equal(mine.get(j.id), j.name, `${code}: ${j.id} names ${j.name}`);
  }
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
  assert.equal(government("oh", "COLUMBUS CITY SCH DIST").division, "ocd-division/country:us/state:oh/school_district:columbus_city_school_district");
});
