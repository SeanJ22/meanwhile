/**
 * **EVERY STATE'S DIVISIONS AND GOVERNMENTS, PAIRED.** (2026-09-23.)
 *
 *   node_modules/.bin/tsx scripts/build-registration-reference.mts [--tiger=<dir>]
 *
 * Sean's direction is to track every state without a code change, the runner
 * keeping each state's registration current. Registration needs two facts per
 * state that no committed file joins today: which Census divisions exist (with
 * the OCD ids every other holding uses) and which of them is each government's
 * territory. This builds both, one file per state under
 * `data/derived/registration/`, from inputs already held:
 *
 * ```
 *   divisions     the 2023 Census cartographic-boundary layers, ids from
 *                 scripts/lib/national-division-ids.mts (the ZIP index's own
 *                 assignment, so a government has one id in both)
 *   governments   the 2022 Census of Governments (data/reference/
 *                 census_govt_units_2022.csv and its dependent school systems)
 * ```
 *
 * ## The pairing, by code wherever the Census gives one
 *
 * ```
 *   county       state + county FIPS          -> the county division
 *   municipal    state + place FIPS           -> the place division, or in a
 *                (+ county)                      strong-MCD state the county
 *                                                subdivision when one exists
 *   township     state + county + place code  -> the county subdivision
 *   school       no code in the CoG           -> the school district of the
 *                                                same normalized name in the
 *                                                state, narrowed by county
 *   special      no Census geography          -> none, named
 * ```
 *
 * A committed id always wins (`pinned`): where a government's place and county
 * subdivision are both committed, the one the registry already keys is kept.
 * Anything that does not pair is written with the reason, never guessed: the
 * file answers "which division is this government's" or says why it cannot.
 *
 * Each government also carries the jurisdiction id the operational reference
 * mints for it (`scripts/enumerate-jurisdictions.mts`: `<st>:<class>:<slug>`,
 * with the Census id appended on a name collision, the state itself first), so
 * a jurisdiction id and an OCD id meet in one row for the first time. Tests
 * hold those ids to the committed AZ, NH and NJ references.
 *
 * No body is minted here. Which governments become bodies, and when, is the
 * registration contract's rule; this file is the reference it reads.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseCsv } from "../lib/reference/index.ts";
import { today } from "./doc-dates.mjs";
import { nationalDivisionIds, type NationalDivision } from "./lib/national-division-ids.mts";

const ROOT = process.cwd();
const TIGER = process.argv.find((a) => a.startsWith("--tiger="))?.slice(8) ?? join(ROOT, ".cache", "tiger");
const OUT = join(ROOT, "data", "derived", "registration");
const GOVERNMENTS = "data/reference/census_govt_units_2022.csv";
const DEPENDENTS = "data/reference/census_govt_units_2022_dependent_school_systems.csv";

/** The Census's strong-MCD states: their county subdivisions are functioning general-purpose governments. */
const STRONG_MCD = new Set(["CT", "ME", "MA", "MI", "MN", "NH", "NJ", "NY", "PA", "RI", "VT", "WI"]);

/* ------------------------------------------------------------ the jurisdiction reference's own id rule */
// Kept identical to scripts/enumerate-jurisdictions.mts (slug, CLASS_OF, PREFIX_OF, the collision suffix).
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
const PREFIX_OF_TYPE: Readonly<Record<string, string>> = {
  COUNTY: "county",
  MUNICIPAL: "city",
  TOWNSHIP: "city",
  "SCHOOL DISTRICT": "school",
  "SPECIAL DISTRICT": "special",
  "DEPENDENT SCHOOL SYSTEM": "depschool",
};

/* ------------------------------------------------------------ school names, compared as the Census writes them both ways */
const EXPAND: Readonly<Record<string, string>> = {
  TWP: "TOWNSHIP", TWSP: "TOWNSHIP", BORO: "BOROUGH", REG: "REGIONAL", RGNL: "REGIONAL",
  CO: "COUNTY", CNTY: "COUNTY", INDEP: "INDEPENDENT", IND: "INDEPENDENT", CONS: "CONSOLIDATED", CONSOL: "CONSOLIDATED",
  ELEM: "ELEMENTARY", CTY: "CITY", COMM: "COMMUNITY", CMNTY: "COMMUNITY", UNIF: "UNIFIED", UNI: "UNIFIED", JT: "JOINT",
  VOC: "VOCATIONAL", TECH: "TECHNICAL", MT: "MOUNT", ST: "SAINT", CTR: "CENTER", CENT: "CENTRAL", CTL: "CENTRAL",
  VLY: "VALLEY", VAL: "VALLEY", VALL: "VALLEY", EX: "EXEMPTED", VLG: "VILLAGE", LOC: "LOCAL", UN: "UNION",
  HTS: "HEIGHTS", SPGS: "SPRINGS", PK: "PARK", LK: "LAKE", N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST",
  ISD: "INDEPENDENT", USD: "UNIFIED", CSD: "CENTRAL", UFSD: "UNION FREE", CUSD: "COMMUNITY UNIT", CCSD: "COMMUNITY CONSOLIDATED",
};
// DISRICT and DISTRIC are the Census file's own misspellings (e.g. "ROUND VALLEY UNIFIED SCHOOL DISRICT 10").
const GENERIC = new Set(["SCHOOL", "SCHOOLS", "SCH", "DISTRICT", "DIST", "DISRICT", "DISTRIC", "PUBLIC", "THE", "OF", "NO", "NUMBER", "AND", "SYSTEM", "SD"]);
/** Words naming the KIND of district, which the Census writes differently in its two files ("Community Unit" / "Consolidated Unit"). Never a place word: County, City, Township and Borough stay, so Baltimore County and Baltimore City never merge. */
const KIND = new Set(["CENTRAL", "LOCAL", "UNIFIED", "ELEMENTARY", "HIGH", "UNION", "FREE", "COMMON", "COMMUNITY", "UNIT", "CONSOLIDATED", "INDEPENDENT", "REGIONAL", "EXEMPTED", "VILLAGE", "JOINT", "SECONDARY", "GRADED", "SPECIAL"]);
function schoolTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .flatMap((t) => (EXPAND[t] ?? t).split(" "))
    .filter((t) => t !== "" && !GENERIC.has(t));
}
/**
 * Four keys, strict to loose: the expanded name; without its district number
 * (Texas and New York number theirs, TIGER does not); without kind words; and
 * without both. The number goes before the kind words so that Tolleson
 * Elementary and Tolleson Union High stay two districts. A key with no letters
 * left is no key.
 */
function schoolKeys(name: string): [string, string, string, string] {
  const exact = schoolTokens(name);
  const isNumber = (t: string) => /^\d+$/.test(t);
  const key = (ts: string[]) => (ts.some((t) => /[A-Z]/.test(t)) ? ts.join(" ") : "");
  return [key(exact), key(exact.filter((t) => !isNumber(t))), key(exact.filter((t) => !KIND.has(t))), key(exact.filter((t) => !KIND.has(t) && !isNumber(t)))];
}
/** TIGER's placeholder for "no district here": real geography, never a government. */
const PLACEHOLDER = /not defined/i;
/** A community-college or vocational district: the Census publishes no school-district polygon for either. */
const NOT_A_TIGER_SCHOOL = /\bCOLLEGE\b|\bVOC\b|\bVOCATIONAL\b|\bJVSD\b|\bCAREER\b/;

/* ------------------------------------------------------------ inputs */
const national = nationalDivisionIds(ROOT, TIGER);
/*
 * A row whose postal state is blank is placed by its state FIPS code, and
 * counted: 13 Texas special districts in the 2022 file carry FIPS 48 and no
 * postal code. The jurisdiction reference, which filters on the postal code,
 * does not list them; this reference does, and says how.
 */
let placedByFips = 0;
function rows(path: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(readFileSync(join(ROOT, path), "utf8"));
  return body
    .filter((r) => r.length >= header.length)
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])))
    .map((r) => {
      if (r.state !== "" || !FIPS_TO_STATE[r.fips_state]) return r;
      placedByFips++;
      return { ...r, state: FIPS_TO_STATE[r.fips_state].postal };
    });
}
const governmentRows = rows(GOVERNMENTS);
const dependentRows = rows(DEPENDENTS);
const inputSha = (path: string) => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");

// A school district's counties, from the ZIPs it shares with them (zip-governments.json): used only to narrow a name.
const zipGov = JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-governments.json"), "utf8")) as {
  zips: Record<string, { layer: string; id: string }[]>;
};
const schoolCounties = new Map<string, Set<string>>();
for (const list of Object.values(zipGov.zips)) {
  const counties = list.filter((e) => e.layer === "county").map((e) => e.id);
  for (const e of list) {
    if (e.layer !== "unsd" && e.layer !== "elsd" && e.layer !== "scsd") continue;
    const key = `${e.layer}:${e.id}`;
    const set = schoolCounties.get(key) ?? new Set<string>();
    for (const c of counties) set.add(c);
    schoolCounties.set(key, set);
  }
}

/* ------------------------------------------------------------ per state */
type Pairing = "STATE" | "COUNTY_FIPS" | "PLACE_FIPS" | "COUSUB_FIPS" | "SCHOOL_NAME" | "SCHOOL_NAME_LOOSE";
type Unpaired =
  | "NO_CENSUS_GEOGRAPHY"
  | "NO_CENSUS_SCHOOL_GEOGRAPHY"
  | "NO_DIVISION_FOR_FIPS"
  | "NO_OCD_ID_FOR_DIVISION"
  | "SCHOOL_NAME_AMBIGUOUS"
  | "SCHOOL_NAME_NOT_FOUND"
  /** The Census row's postal state and state FIPS code name two states (141 rows in 2022: filing errors and two-state cities such as Texarkana). It stays where the postal code puts it, as the jurisdiction reference does, and is not paired across states. */
  | "STATE_CODES_DISAGREE";
/** A division as the reference writes it: the state itself, then every Census division in it. */
interface DivisionRow {
  readonly key: string;
  readonly ocdId: string;
  readonly layer: NationalDivision["layer"] | "state";
  readonly geoid: string;
  readonly censusName: string;
}
interface StateOut {
  readonly divisions: DivisionRow[];
  /**
   * `alternate` is the other division a municipality's code names when it is
   * both a place and a county subdivision (4,317 in 2022). The default rule
   * picks one; the registration contract keeps whichever of the two the
   * reviewed registry already holds a body on, so one government never gets
   * two bodies. -1 when there is no alternate.
   */
  readonly governments: [pid6: string, jurisdictionId: string, name: string, govType: string, division: number, how: Pairing | Unpaired, alternate: number][];
}

const stateName = new Map(US_STATES.map((s) => [s.code.toUpperCase(), s.name]));
const fipsOfPostal = new Map(Object.entries(FIPS_TO_STATE).map(([fips, s]) => [s.postal, fips]));
const byState = new Map<string, NationalDivision[]>();
for (const d of national.divisions.values()) {
  const postal = FIPS_TO_STATE[d.statefp]?.postal;
  if (!postal) continue;
  const list = byState.get(postal) ?? [];
  list.push(d);
  byState.set(postal, list);
}
const postals = [...new Set([...governmentRows.map((r) => r.state), ...byState.keys()])].filter((p) => fipsOfPostal.has(p)).sort();

const results = new Map<string, StateOut>();
const tally: Record<string, Record<string, number>> = {};
for (const postal of postals) {
  const fips = fipsOfPostal.get(postal)!;
  const entry = FIPS_TO_STATE[fips];
  const name = stateName.get(postal) ?? postal;
  const stateDivision: DivisionRow = { key: `state:${fips}`, layer: "state", geoid: fips, ocdId: `ocd-division/country:us/${entry.prefix}:${postal.toLowerCase()}`, censusName: name };
  const divisions = [...(byState.get(postal) ?? [])].sort((a, b) => a.ocdId.localeCompare(b.ocdId) || a.key.localeCompare(b.key));
  const all: DivisionRow[] = [stateDivision, ...divisions];
  const at = new Map(all.map((d, i) => [d.key, i]));
  const schoolTiers = Array.from({ length: 4 }, () => new Map<string, NationalDivision[]>());
  for (const d of divisions) {
    if (d.layer !== "unsd" && d.layer !== "elsd" && d.layer !== "scsd") continue;
    if (PLACEHOLDER.test(d.censusName)) continue;
    schoolKeys(d.censusName).forEach((k, tier) => {
      if (k !== "") schoolTiers[tier].set(k, [...(schoolTiers[tier].get(k) ?? []), d]);
    });
  }
  const seen = new Set<string>();
  const governments: StateOut["governments"] = [];
  const add = (pid6: string, unitName: string, govType: string, division: number, how: Pairing | Unpaired, prefix: string, alternate = -1) => {
    let id = `${postal.toLowerCase()}:${prefix}:${slug(unitName)}`;
    if (seen.has(id)) id = `${id}-${pid6}`;
    seen.add(id);
    governments.push([pid6, id, unitName, govType, division, how, alternate]);
  };
  add("state", name, "STATE", 0, "STATE", "state");

  // Strict to loose; each tier takes a match only if it is the one school of that name (in the government's county, if the state has several).
  const pairSchool = (unitName: string, countyFips: string): { division: number; how: Pairing | Unpaired } => {
    if (NOT_A_TIGER_SCHOOL.test(unitName.toUpperCase())) return { division: -1, how: "NO_CENSUS_SCHOOL_GEOGRAPHY" };
    const keys = schoolKeys(unitName);
    for (let tier = 0; tier < keys.length; tier++) {
      if (keys[tier] === "") continue;
      const matches = schoolTiers[tier].get(keys[tier]) ?? [];
      if (matches.length === 0) continue;
      const pick = matches.length === 1 ? matches : matches.filter((m) => countyFips !== "" && schoolCounties.get(m.key)?.has(fips + countyFips));
      if (pick.length === 1) return { division: at.get(pick[0].key)!, how: tier === 0 ? "SCHOOL_NAME" : "SCHOOL_NAME_LOOSE" };
      return { division: -1, how: "SCHOOL_NAME_AMBIGUOUS" };
    }
    return { division: -1, how: "SCHOOL_NAME_NOT_FOUND" };
  };
  const noFipsDivision = (key: string): Unpaired => (national.withoutId.has(key) ? "NO_OCD_ID_FOR_DIVISION" : "NO_DIVISION_FOR_FIPS");

  for (const r of governmentRows.filter((g) => g.state === postal)) {
    const type = r.gov_type;
    const prefix = PREFIX_OF_TYPE[type];
    if (!prefix) continue;
    const countyKey = `county:${fips}${r.fips_county}`;
    const placeKey = `place:${fips}${r.fips_place}`;
    const cousubKey = `cousub:${fips}${r.fips_county}${r.fips_place}`;
    let division = -1;
    let alternate = -1;
    let how: Pairing | Unpaired = "NO_DIVISION_FOR_FIPS";
    if (type === "SPECIAL DISTRICT") {
      how = "NO_CENSUS_GEOGRAPHY";
    } else if (r.fips_state !== "" && r.fips_state !== fips) {
      how = "STATE_CODES_DISAGREE";
    } else if (type === "COUNTY") {
      if (at.has(countyKey)) { division = at.get(countyKey)!; how = "COUNTY_FIPS"; }
      else how = noFipsDivision(countyKey);
    } else if (type === "MUNICIPAL") {
      const place = r.fips_place !== "" && at.has(placeKey);
      const cousub = r.fips_place !== "" && at.has(cousubKey);
      // The committed id wins; then the strong-MCD rule; then whichever exists.
      const pinnedPlace = place && national.pinned.has(placeKey);
      const pinnedCousub = cousub && national.pinned.has(cousubKey);
      const useCousub = cousub && (pinnedCousub || (!pinnedPlace && (STRONG_MCD.has(postal) || !place)));
      if (useCousub) { division = at.get(cousubKey)!; how = "COUSUB_FIPS"; if (place) alternate = at.get(placeKey)!; }
      else if (place) { division = at.get(placeKey)!; how = "PLACE_FIPS"; if (cousub) alternate = at.get(cousubKey)!; }
      else how = national.withoutId.has(placeKey) || national.withoutId.has(cousubKey) ? "NO_OCD_ID_FOR_DIVISION" : "NO_DIVISION_FOR_FIPS";
    } else if (type === "TOWNSHIP") {
      if (r.fips_place !== "" && at.has(cousubKey)) { division = at.get(cousubKey)!; how = "COUSUB_FIPS"; }
      else how = noFipsDivision(cousubKey);
    } else if (type === "SCHOOL DISTRICT") {
      ({ division, how } = pairSchool(r.unit_name, r.fips_county));
    } else {
      how = "NO_CENSUS_GEOGRAPHY";
    }
    add(r.census_id_pid6, r.unit_name, type, division, how, prefix, alternate);
  }
  for (const r of dependentRows.filter((g) => g.state === postal)) {
    const { division, how } = pairSchool(r.unit_name, r.fips_county);
    add(r.census_id_pid6, r.unit_name, "DEPENDENT SCHOOL SYSTEM", division, how, "depschool");
  }
  // A school district claimed by two governments by name is not either's: both are named ambiguous.
  const claims = new Map<number, number[]>();
  governments.forEach((g, i) => {
    if (g[5] === "SCHOOL_NAME" || g[5] === "SCHOOL_NAME_LOOSE") claims.set(g[4], [...(claims.get(g[4]) ?? []), i]);
  });
  for (const list of claims.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      governments[i][4] = -1;
      governments[i][5] = "SCHOOL_NAME_AMBIGUOUS";
    }
  }
  const count: Record<string, number> = {};
  for (const g of governments) count[`${g[3]}:${g[5]}`] = (count[`${g[3]}:${g[5]}`] ?? 0) + 1;
  results.set(postal, { divisions: all, governments });
  tally[postal] = count;
}

/* ------------------------------------------------------------ one refusal: nothing a state holds may vanish silently */
const expected = governmentRows.filter((r) => PREFIX_OF_TYPE[r.gov_type]).length + dependentRows.length + postals.length;
const written = [...results.values()].reduce((n, s) => n + s.governments.length, 0);
if (written !== expected) throw new Error(`${expected - written} government row(s) were dropped between the Census file and the reference`);

/* ------------------------------------------------------------ write */
if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));
mkdirSync(OUT, { recursive: true });
const index: Record<string, { readonly sha256: string; readonly divisions: number; readonly governments: number; readonly paired: number }> = {};
for (const [postal, s] of results) {
  const payload = {
    formatVersion: 1,
    state: postal.toLowerCase(),
    divisions: s.divisions.map((d) => [d.ocdId, d.layer, d.geoid, d.censusName]),
    governments: s.governments,
  };
  const text = `${JSON.stringify(payload)}\n`;
  writeFileSync(join(OUT, `${postal.toLowerCase()}.json`), text, "utf8");
  index[postal.toLowerCase()] = {
    sha256: createHash("sha256").update(text).digest("hex"),
    divisions: s.divisions.length,
    governments: s.governments.length,
    paired: s.governments.filter((g) => g[4] >= 0).length,
  };
}
const national_ = Object.values(tally).reduce<Record<string, number>>((acc, t) => {
  for (const [k, v] of Object.entries(t)) acc[k] = (acc[k] ?? 0) + v;
  return acc;
}, {});
writeFileSync(
  join(OUT, "index.json"),
  `${JSON.stringify(
    {
      formatVersion: 1,
      generatedAt: today(),
      source: `Divisions: the 2023 Census cartographic-boundary layers (ids from scripts/lib/national-division-ids.mts). Governments: ${GOVERNMENTS} (sha256 ${inputSha(GOVERNMENTS)}) and ${DEPENDENTS} (sha256 ${inputSha(DEPENDENTS)}), the 2022 Census of Governments.`,
      note:
        "Each state's divisions ([ocdId, layer, GEOID, Census name]) and governments ([Census id, jurisdiction id, name, type, division index or -1, how it paired or why it did not]). A government pairs by Census code where the Census gives one and by normalized name for school districts; nothing unpaired is guessed. No body is minted here.",
      counts: { states: results.size, governments: written, placedByStateFipsForABlankPostalCode: placedByFips, byTypeAndPairing: national_ },
      states: index,
    },
    null,
    1,
  )}\n`,
  "utf8",
);
console.log(`states ${results.size}; governments ${written}; divisions ${[...results.values()].reduce((n, s) => n + s.divisions.length, 0)}`);
for (const [k, v] of Object.entries(national_).sort()) console.log(`  ${k.padEnd(44)} ${v}`);
