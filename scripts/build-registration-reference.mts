/**
 * Every state's divisions and governments, paired.
 *
 *   node_modules/.bin/tsx scripts/build-registration-reference.mts [--tiger=<dir>]
 *
 * Registration needs two facts per state: which Census divisions exist (with
 * the OCD ids every other holding uses) and which of them is each government's
 * territory. This builds both, one file per state under
 * `data/derived/registration/`, from inputs already held:
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
 *                                                subdivision when one exists;
 *                                                a consolidated city-county whose
 *                                                code no layer carries, its county
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
 * ## The territories, from the Census's functional status
 *
 * The Census of Governments does not enumerate American Samoa, Guam, the
 * Northern Mariana Islands, Puerto Rico or the U.S. Virgin Islands. Their
 * governments come from TIGER/Line 2023's FUNCSTAT, committed as
 * `data/reference/census_tiger_2023_territory_functional_status.csv`
 * by `scripts/extract-territory-functional-status.mts`. A territory's county,
 * county-subdivision and place divisions carry their LSAD, FUNCSTAT and
 * CLASSFP, and a government row is written for each one whose status governs
 * (A, B, C, G), under its Census legal name. Every other status (F, N, S, I)
 * is geography only. A territory whose divisions all carry a non-governing
 * status has no government row, and its file records the evidence that says
 * so; the territory itself gets no government row beyond its STATE line, as
 * no state does. A territory division with no TIGER/Line status refuses the
 * build: a missing status is no evidence either way.
 * Unchanged states keep their build date: each state's entry in `index.json`
 * carries the date its file last changed, so a rebuild that leaves a state's
 * bytes alone leaves its registration's records alone too.
 *
 * Each government also carries the jurisdiction id the operational reference
 * mints for it (`scripts/enumerate-jurisdictions.mts`: `<st>:<class>:<slug>`,
 * with the Census id appended on a name collision, the state itself first), so
 * a jurisdiction id and an OCD id meet in one row.
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
const FUNCSTAT = "data/reference/census_tiger_2023_territory_functional_status.csv";
/** The functional statuses that govern: active, partially consolidated, consolidated, subordinate. */
const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);
/** The TIGER/Line layers the functional status is read for, and the Census entity each one's government is. */
const FUNCSTAT_LAYERS: Readonly<Record<string, { readonly govType: string; readonly prefix: string }>> = {
  county: { govType: "COUNTY-EQUIVALENT GOVERNMENT", prefix: "county" },
  cousub: { govType: "COUNTY SUBDIVISION GOVERNMENT", prefix: "city" },
  place: { govType: "PLACE GOVERNMENT", prefix: "city" },
};
/** The TIGER/Line archive a territory layer's status was read from (the extract's own provenance note names each read). */
const tigerLineUrl = (layer: string, fips: string) =>
  layer === "county"
    ? "https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip"
    : `https://www2.census.gov/geo/tiger/TIGER2023/${layer.toUpperCase()}/tl_2023_${fips}_${layer}.zip`;

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
/** The territories' TIGER/Line statuses by `<layer>:<GEOID>`, the key every build joins on. */
const functionalStatus = new Map<string, { readonly lsad: string; readonly funcstat: string; readonly classfp: string }>();
{
  const [header, ...body] = parseCsv(readFileSync(join(ROOT, FUNCSTAT), "utf8"));
  const col = (name: string) => header.indexOf(name);
  for (const r of body.filter((r) => r.length >= header.length)) {
    functionalStatus.set(`${r[col("layer")]}:${r[col("geoid")]}`, { lsad: r[col("lsad")], funcstat: r[col("funcstat")], classfp: r[col("classfp")] });
  }
}
/** Every state and county the Census of Governments lists a COUNTY government for, as `<postal>:<county FIPS>`. */
const countyGovernments = new Set(governmentRows.filter((r) => r.gov_type === "COUNTY").map((r) => `${r.state}:${r.fips_county}`));
const words = (s: string) => ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()} `;

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
type Pairing =
  | "STATE"
  | "COUNTY_FIPS"
  | "PLACE_FIPS"
  | "COUSUB_FIPS"
  | "SCHOOL_NAME"
  | "SCHOOL_NAME_LOOSE"
  /** A consolidated city-county, on its county division (see the MUNICIPAL branch below). */
  | "CONSOLIDATED_COUNTY_FIPS"
  /** A territory government: the division TIGER/Line gives a governing functional status, which is its own territory. */
  | "TIGER_FUNCSTAT";
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
  /** A territory's county, county-subdivision or place division: its TIGER/Line LSAD, FUNCSTAT and CLASSFP. */
  readonly status?: { readonly lsad: string; readonly funcstat: string; readonly classfp: string };
}
interface StateOut {
  readonly divisions: DivisionRow[];
  /** A territory's TIGER/Line status source, per layer; absent for a state, whose governments are the Census of Governments'. */
  readonly functionalStatus?: Readonly<Record<string, string>>;
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
let funcstatGovernments = 0;
/** Per territory and layer, how many divisions carry each functional status: the evidence behind its government rows, or behind none. */
const statusTally: Record<string, Record<string, Record<string, number>>> = {};
for (const postal of postals) {
  const fips = fipsOfPostal.get(postal)!;
  const entry = FIPS_TO_STATE[fips];
  const territory = entry.prefix === "territory";
  const name = stateName.get(postal) ?? postal;
  const stateDivision: DivisionRow = { key: `state:${fips}`, layer: "state", geoid: fips, ocdId: `ocd-division/country:us/${entry.prefix}:${postal.toLowerCase()}`, censusName: name };
  const divisions = [...(byState.get(postal) ?? [])].sort((a, b) => a.ocdId.localeCompare(b.ocdId) || a.key.localeCompare(b.key));
  const withStatus = (d: NationalDivision): DivisionRow => {
    if (!territory || !FUNCSTAT_LAYERS[d.layer]) return d;
    const status = functionalStatus.get(d.key);
    if (!status || status.funcstat === "") throw new Error(`${postal}: ${d.key} (${d.censusName}) has no TIGER/Line functional status in ${FUNCSTAT}; a territory's governments cannot be read without it.`);
    const layerTally = ((statusTally[postal] ??= {})[d.layer] ??= {});
    layerTally[status.funcstat] = (layerTally[status.funcstat] ?? 0) + 1;
    return { ...d, status };
  };
  const all: DivisionRow[] = [stateDivision, ...divisions.map(withStatus)];
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
  const add = (pid6: string, unitName: string, govType: string, division: number, how: Pairing | Unpaired, prefix: string, alternate = -1, suffix = pid6) => {
    let id = `${postal.toLowerCase()}:${prefix}:${slug(unitName)}`;
    if (seen.has(id)) id = `${id}-${suffix}`;
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
  /*
   * A consolidated city-county: the Census of Governments files it as MUNICIPAL under the consolidated city's own
   * place code, which no boundary layer carries (the layers hold its "(balance)" instead) — Louisville/Jefferson
   * County, Nashville-Davidson, Athens-Clarke, Honolulu, Butte-Silver Bow, Greeley County KS. It is its county's
   * government, so it pairs to the county division, but only when three facts agree: no place or county
   * subdivision carries its code, the Census lists no COUNTY government in that county, and its own name carries
   * the county's Census name. The name is the guard: Pomfret CT and Greenfield MA also miss their codes in counties
   * with no county government, and neither is its county.
   */
  const consolidatedCounty = (r: Record<string, string>, countyKey: string): boolean => {
    const county = national.divisions.get(countyKey);
    if (!county || !at.has(countyKey) || countyGovernments.has(`${postal}:${r.fips_county}`)) return false;
    return words(r.unit_name).includes(words(county.label));
  };

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
      else if (consolidatedCounty(r, countyKey)) { division = at.get(countyKey)!; how = "CONSOLIDATED_COUNTY_FIPS"; }
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
  // A territory's governments: each division whose TIGER/Line status governs, under its Census legal name and its own `<layer>:<GEOID>`.
  all.forEach((d, i) => {
    if (!d.status || !GOVERNING_FUNCSTAT.has(d.status.funcstat)) return;
    const kind = FUNCSTAT_LAYERS[d.layer];
    add(d.key, d.censusName, kind.govType, i, "TIGER_FUNCSTAT", kind.prefix, -1, d.geoid);
    funcstatGovernments++;
  });
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
  const statusSources = territory ? Object.fromEntries(Object.keys(FUNCSTAT_LAYERS).map((layer) => [layer, tigerLineUrl(layer, fips)])) : undefined;
  results.set(postal, { divisions: all, governments, ...(statusSources ? { functionalStatus: statusSources } : {}) });
  tally[postal] = count;
}

/* ------------------------------------------------------------ one refusal: nothing a state holds may vanish silently */
const expected = governmentRows.filter((r) => PREFIX_OF_TYPE[r.gov_type]).length + dependentRows.length + postals.length + funcstatGovernments;
const written = [...results.values()].reduce((n, s) => n + s.governments.length, 0);
if (written !== expected) throw new Error(`${expected - written} government row(s) were dropped between the Census file and the reference`);

/* ------------------------------------------------------------ write */
// The prior index, read before anything is removed: a state whose bytes do not change keeps the date it was built.
const INDEX = join(OUT, "index.json");
const previous = existsSync(INDEX)
  ? (JSON.parse(readFileSync(INDEX, "utf8")) as { readonly generatedAt: string; readonly states: Readonly<Record<string, { readonly sha256: string; readonly generatedAt?: string }>> })
  : null;
if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));
mkdirSync(OUT, { recursive: true });
const index: Record<string, { readonly sha256: string; readonly divisions: number; readonly governments: number; readonly paired: number; readonly generatedAt: string }> = {};
for (const [postal, s] of results) {
  const payload = {
    formatVersion: 1,
    state: postal.toLowerCase(),
    ...(s.functionalStatus ? { functionalStatus: { dataset: FUNCSTAT, sha256: inputSha(FUNCSTAT), sources: s.functionalStatus } } : {}),
    divisions: s.divisions.map((d) => (d.status ? [d.ocdId, d.layer, d.geoid, d.censusName, d.status.lsad, d.status.funcstat, d.status.classfp] : [d.ocdId, d.layer, d.geoid, d.censusName])),
    governments: s.governments,
  };
  const text = `${JSON.stringify(payload)}\n`;
  writeFileSync(join(OUT, `${postal.toLowerCase()}.json`), text, "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  const prior = previous?.states[postal.toLowerCase()];
  index[postal.toLowerCase()] = {
    sha256,
    divisions: s.divisions.length,
    governments: s.governments.length,
    paired: s.governments.filter((g) => g[4] >= 0).length,
    generatedAt: prior?.sha256 === sha256 ? (prior.generatedAt ?? previous!.generatedAt) : today(),
  };
}
const national_ = Object.values(tally).reduce<Record<string, number>>((acc, t) => {
  for (const [k, v] of Object.entries(t)) acc[k] = (acc[k] ?? 0) + v;
  return acc;
}, {});
writeFileSync(
  INDEX,
  `${JSON.stringify(
    {
      formatVersion: 1,
      generatedAt: today(),
      source: `Divisions: the 2023 Census cartographic-boundary layers (ids from scripts/lib/national-division-ids.mts). Governments: ${GOVERNMENTS} (sha256 ${inputSha(GOVERNMENTS)}) and ${DEPENDENTS} (sha256 ${inputSha(DEPENDENTS)}), the 2022 Census of Governments; for the territories, which it does not enumerate, ${FUNCSTAT} (sha256 ${inputSha(FUNCSTAT)}), TIGER/Line 2023 functional status.`,
      note:
        "Each state's divisions ([ocdId, layer, GEOID, Census name], and for a territory's county, county-subdivision and place divisions also [LSAD, FUNCSTAT, CLASSFP]) and governments ([Census id, jurisdiction id, name, type, division index or -1, how it paired or why it did not]). A government pairs by Census code where the Census gives one and by normalized name for school districts; a territory's governments are its divisions whose TIGER/Line status governs (A, B, C, G), with `<layer>:<GEOID>` as their Census id. Nothing unpaired is guessed. No body is minted here. Each state's generatedAt is the date its file last changed.",
      counts: {
        states: results.size,
        governments: written,
        placedByStateFipsForABlankPostalCode: placedByFips,
        byTypeAndPairing: national_,
        functionalStatusByTerritory: statusTally,
      },
      states: index,
    },
    null,
    1,
  )}\n`,
  "utf8",
);
console.log(`states ${results.size}; governments ${written}; divisions ${[...results.values()].reduce((n, s) => n + s.divisions.length, 0)}`);
for (const [k, v] of Object.entries(national_).sort()) console.log(`  ${k.padEnd(44)} ${v}`);
for (const [postal, layers] of Object.entries(statusTally)) console.log(`  ${postal} FUNCSTAT ${JSON.stringify(layers)}`);
const changed = Object.entries(index).filter(([code, e]) => previous?.states[code]?.sha256 !== e.sha256).map(([code]) => code);
console.log(`changed state files: ${changed.length === 0 ? "none" : changed.join(", ")}`);
