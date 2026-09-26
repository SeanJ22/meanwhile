/**
 * The Census ↔ NCES school-district crosswalk (Prompt B item 4, 2026-08-20).
 *
 * THERE IS NO SHARED IDENTIFIER IN THE TWO FILES WE HOLD. The Census unit file
 * carries `census_id_pid6` (and the legacy `census_id_gidid`, banned as a join
 * key by item 3); the CCD LEA directory carries `nces_leaid` and `state_leaid`.
 * NCES publishes a Census ID on the F-33 fiscal survey, which is a THIRD file
 * this repo does not have and which item 9 gets a row for. So this crosswalk is
 * built on normalized name within state, and it is honest about what that costs.
 *
 * THE RULE THAT SHAPES EVERYTHING BELOW: do not force matches. A normalized
 * name that resolves to more than one row on either side is AMBIGUOUS, and an
 * ambiguous match is recorded as unmatched. This is deliberately the
 * pessimistic direction — a crosswalk that overstates its coverage is worse
 * than one that understates it, because the overstatement lands downstream as
 * a district card confidently pointing at the wrong district.
 *
 * WHAT THE TWO FILES COUNT IS NOT THE SAME THING (RULING 9 in miniature).
 * Census counts school-district GOVERNMENTS: 12,546 independent districts,
 * with school systems that are an agency of another government held in a
 * separate file of 1,313 dependent systems. CCD counts LEAs: 19,711 records
 * including charter agencies, service agencies, supervisory unions and
 * state-operated agencies that are not governments at all. CCD does NOT
 * distinguish dependent from independent — Connecticut, Maine, Massachusetts
 * and Virginia school systems that Census files as dependent appear in CCD as
 * ordinary regular districts.
 *
 * So the crosswalk is run against the COMBINED Census school-system universe
 * of 13,859 (12,546 + 1,313), because matching CCD against the independent
 * file alone would report 1,313 real, correctly-recorded school systems as
 * NCES rows with no Census match — a fabricated gap. Item 4.2's unmatched
 * counts are then reported against BOTH denominators, so neither reading is
 * hidden by the other.
 *
 * Run:  corepack pnpm crosswalk:build
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readTable } from "../lib/reference/index.ts";
import { normalizeName, schoolNameKey } from "../lib/registry/school-name-key.ts";

const OUT_DIR = join(process.cwd(), "data", "derived");
const OUT_CSV = join(OUT_DIR, "census-nces-crosswalk.csv");

/* -------------------------------------------------------------------------- */
/* Name normalization                                                         */
/*                                                                            */
/* Every suffix stripped here is a NAMING CONVENTION difference between the   */
/* two agencies, not a difference between two districts. "AUTAUGA COUNTY      */
/* SCHOOL DISTRICT" (Census) and "Autauga County" (CCD) are one government    */
/* written twice. Anything that could distinguish two real districts —        */
/* ordinals, numbers, directions — is KEPT, which is why "UNION SCHOOL        */
/* DISTRICT 1" and "UNION SCHOOL DISTRICT 2" stay apart and land in the       */
/* ambiguous bucket rather than being silently merged.                        */
/* -------------------------------------------------------------------------- */

/*
 * The normalizer and its three tables MOVED to lib/registry/school-name-key.ts
 * on 2026-08-22 (DEF-2, item 11), unchanged, comments and all. It moved because
 * a second caller needed to reproduce this exact key in order to look a district
 * up in the crosswalk this file writes — and two copies of a normalizer is two
 * copies that drift apart silently, which reads as a district that is simply not
 * in the data rather than as a bug.
 */
const key = schoolNameKey;

/* -------------------------------------------------------------------------- */
/* Load both sides                                                            */
/* -------------------------------------------------------------------------- */

type Side = {
  id: string;
  name: string;
  fips: string;
  state: string;
  kind: string;
};

function censusSchoolSystems(): Side[] {
  const out: Side[] = [];

  const independent = readTable("census_govt_units_2022");
  const [idI, nameI, typeI, fipsI, stI] = [
    "census_id_pid6",
    "unit_name",
    "gov_type",
    "fips_state",
    "state",
  ].map((c) => independent.header.indexOf(c));
  for (const r of independent.rows) {
    if (r[typeI] !== "SCHOOL DISTRICT") continue;
    out.push({
      id: r[idI] ?? "",
      name: r[nameI] ?? "",
      fips: r[fipsI] ?? "",
      state: r[stI] ?? "",
      kind: "INDEPENDENT",
    });
  }

  const dependent = readTable("census_govt_units_2022_dependent_school_systems");
  const [idD, nameD, fipsD, stD] = [
    "census_id_pid6",
    "unit_name",
    "fips_state",
    "state",
  ].map((c) => dependent.header.indexOf(c));
  for (const r of dependent.rows) {
    out.push({
      id: r[idD] ?? "",
      name: r[nameD] ?? "",
      fips: r[fipsD] ?? "",
      state: r[stD] ?? "",
      kind: "DEPENDENT",
    });
  }

  return out;
}

function ncesLeas(): Side[] {
  const t = readTable("nces_ccd_lea_directory_2025_26");
  const [id, name, fips, st, comparable] = [
    "nces_leaid",
    "lea_name",
    "fips_state",
    "state",
    "derived_census_comparable",
  ].map((c) => t.header.indexOf(c));
  return t.rows.map((r) => ({
    id: r[id] ?? "",
    name: r[name] ?? "",
    fips: r[fips] ?? "",
    state: r[st] ?? "",
    kind: r[comparable] === "Y" ? "CENSUS_COMPARABLE" : "NOT_COMPARABLE",
  }));
}

/* -------------------------------------------------------------------------- */
/* Match                                                                      */
/* -------------------------------------------------------------------------- */

function index(rows: Side[]): Map<string, Side[]> {
  const m = new Map<string, Side[]>();
  for (const r of rows) {
    const k = key(r.fips, r.name);
    const bucket = m.get(k);
    if (bucket) bucket.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const census = censusSchoolSystems();
const nces = ncesLeas();
const censusBy = index(census);
const ncesBy = index(nces);

type Pair = { census: Side; nces: Side; key: string };
const matched: Pair[] = [];
const ambiguous: Array<{ key: string; censusRows: number; ncesRows: number }> = [];

/* The normalizer deliberately removes HIGH/ELEMENTARY and therefore collapses
 * these two distinct Patagonia governments. The held official directories name
 * both uniquely: Census 2022 pid6 177987 (secondary only), 209974 (elementary
 * only); NCES 2025-26 0406030 (09–12), 0406000 (PK–08), both at PO Box 254,
 * Patagonia AZ. Preserve the type distinction instead of guessing a numeric
 * suffix match: the NCES parentheses are state LEA ids, not district numbers. */
const patagonia = [
  ["177987", "PATAGONIA UNION HIGH SCHOOL DISTRICT 20", "0406030", "Patagonia Union High School District (4462)"],
  ["209974", "PATAGONIA ELEMENTARY SCHOOL DISTRICT 6", "0406000", "Patagonia Elementary District (4460)"],
] as const;
for (const [pid6, censusName, leaid, ncesName] of patagonia) {
  const c = census.find(r => r.id === pid6 && r.name === censusName && r.fips === "04");
  const n = nces.find(r => r.id === leaid && r.name === ncesName && r.fips === "04");
  if (!c || !n) throw new Error(`Patagonia official-directory identity changed: ${pid6}/${leaid}; revalidate the bridge`);
  matched.push({ census: c, nces: n, key: `04|PATAGONIA#official-directory-type:${leaid}` });
}

for (const [k, censusRows] of censusBy) {
  const remainingCensus = censusRows.filter(c => !matched.some(m => m.census.id === c.id));
  const ncesRows = ncesBy.get(k)?.filter(n => !matched.some(m => m.nces.id === n.id));
  if (remainingCensus.length !== censusRows.length) {
    if (remainingCensus.length || ncesRows?.length) throw new Error(`Explicit identity bridge only partly resolved ${k}; inspect remaining identities`);
    continue;
  }
  if (!ncesRows) continue;

  // ONE-TO-ONE ONLY. Anything else is ambiguous and counts as unmatched on
  // both sides — never resolved by picking the first, the largest or the
  // nearest, because each of those is a guess wearing a match's clothes.
  if (censusRows.length === 1 && ncesRows.length === 1) {
    matched.push({ census: censusRows[0]!, nces: ncesRows[0]!, key: k });
    continue;
  }

  // ONE TIE-BREAK, and only where BOTH sides carry a district number. This is
  // Illinois: `PAYSON COMMUNITY UNIT SCHOOL DISTRICT 1` and `Payson CUSD 1`
  // share a core with district 2 next door, and the number is the real
  // distinction both agencies recorded. Where only one side numbers its
  // districts — Texas — the tie stands and the rows stay unmatched, because
  // a number matched against nothing is not evidence.
  const censusNums = new Map<string, Side[]>();
  for (const c of censusRows) {
    const n = normalizeName(c.name).num;
    if (!n) continue;
    censusNums.set(n, [...(censusNums.get(n) ?? []), c]);
  }
  const ncesNums = new Map<string, Side[]>();
  for (const n of ncesRows) {
    const num = normalizeName(n.name).num;
    if (!num) continue;
    ncesNums.set(num, [...(ncesNums.get(num) ?? []), n]);
  }

  let brokenByNumber = 0;
  for (const [num, cRows] of censusNums) {
    const nRows = ncesNums.get(num);
    if (cRows.length === 1 && nRows?.length === 1) {
      matched.push({ census: cRows[0]!, nces: nRows[0]!, key: `${k}#${num}` });
      brokenByNumber += 1;
    }
  }

  // Whatever the number could not separate is still ambiguous, and is
  // reported as such rather than absorbed into the matched count.
  const unresolvedCensus = censusRows.length - brokenByNumber;
  const unresolvedNces = ncesRows.length - brokenByNumber;
  if (unresolvedCensus > 0 && unresolvedNces > 0) {
    ambiguous.push({ key: k, censusRows: unresolvedCensus, ncesRows: unresolvedNces });
  }
}

const matchedCensusIds = new Set(matched.map((m) => m.census.id));
const matchedNcesIds = new Set(matched.map((m) => m.nces.id));

const censusIndependent = census.filter((c) => c.kind === "INDEPENDENT");
const censusDependent = census.filter((c) => c.kind === "DEPENDENT");
const ncesComparable = nces.filter((n) => n.kind === "CENSUS_COMPARABLE");

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2)}%`;

const unmatchedCensusAll = census.filter((c) => !matchedCensusIds.has(c.id));
const unmatchedIndependent = censusIndependent.filter((c) => !matchedCensusIds.has(c.id));
const unmatchedDependent = censusDependent.filter((c) => !matchedCensusIds.has(c.id));
const unmatchedNcesAll = nces.filter((n) => !matchedNcesIds.has(n.id));
const unmatchedNcesComparable = ncesComparable.filter((n) => !matchedNcesIds.has(n.id));

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

say("CENSUS <-> NCES SCHOOL-DISTRICT CROSSWALK");
say("");
say("JOIN KEY: fips_state + normalized district name. There is no shared");
say("identifier in the two files this repo holds; NCES publishes a Census ID on");
say("the F-33 fiscal survey, which is a separate acquisition.");
say("METHOD: one-to-one only. A normalized name resolving to more than one row");
say("on either side is AMBIGUOUS and is counted as UNMATCHED, not resolved.");
say("");
say(`Census school systems loaded: ${census.length}`);
say(`  independent (gov_type = SCHOOL DISTRICT):  ${censusIndependent.length}`);
say(`  dependent (separate Census file):          ${censusDependent.length}`);
say(`NCES LEA records loaded: ${nces.length}`);
say(`  derived_census_comparable = Y:             ${ncesComparable.length}`);
say("");
say(`MATCHED PAIRS: ${matched.length}`);
say(`AMBIGUOUS KEYS (counted as unmatched on both sides): ${ambiguous.length}`);
say("");
say("UNMATCHED, CENSUS SIDE:");
say(
  `  of 12,546 independent school districts:  ${unmatchedIndependent.length} (${pct(unmatchedIndependent.length, censusIndependent.length)})`,
);
say(
  `  of 1,313 dependent school systems:       ${unmatchedDependent.length} (${pct(unmatchedDependent.length, censusDependent.length)})`,
);
say(
  `  of 13,859 combined school systems:       ${unmatchedCensusAll.length} (${pct(unmatchedCensusAll.length, census.length)})`,
);
say("");
say("UNMATCHED, NCES SIDE:");
say(
  `  of 19,711 CCD LEA records:               ${unmatchedNcesAll.length} (${pct(unmatchedNcesAll.length, nces.length)})`,
);
say(
  `  of 13,299 census-comparable LEAs:        ${unmatchedNcesComparable.length} (${pct(unmatchedNcesComparable.length, ncesComparable.length)})`,
);
say("");
say(
  "The 19,711 denominator is the honest one to state and the wrong one to be",
);
say(
  "alarmed by: 6,412 of those records are charter agencies, service agencies,",
);
say(
  "supervisory unions and state-operated agencies that are not governments and",
);
say("have no Census row to match, by construction.");

/* Per-state unmatched, so a state-level coverage claim can see its own gap. */
const perState = new Map<string, { census: number; nces: number }>();
for (const c of unmatchedCensusAll) {
  const e = perState.get(c.state) ?? { census: 0, nces: 0 };
  e.census += 1;
  perState.set(c.state, e);
}
for (const n of unmatchedNcesComparable) {
  const e = perState.get(n.state) ?? { census: 0, nces: 0 };
  e.nces += 1;
  perState.set(n.state, e);
}
say("");
say("WORST TEN STATES BY UNMATCHED CENSUS SYSTEMS:");
for (const [state, e] of [...perState.entries()]
  .sort((a, b) => b[1].census - a[1].census)
  .slice(0, 10)) {
  say(`  ${state}: ${e.census} Census unmatched, ${e.nces} comparable-LEA unmatched`);
}

/* -------------------------------------------------------------------------- */
/* Write the artifact                                                         */
/* -------------------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csv = [
  "census_id_pid6,census_unit_name,census_kind,nces_leaid,nces_lea_name,nces_kind,fips_state,state,match_key",
  ...matched.map((m) =>
    [
      m.census.id,
      m.census.name,
      m.census.kind,
      m.nces.id,
      m.nces.name,
      m.nces.kind,
      m.census.fips,
      m.census.state,
      m.key,
    ]
      .map(esc)
      .join(","),
  ),
].join("\n");
writeFileSync(OUT_CSV, `${csv}\n`, "utf8");

say("");
say(`WROTE: data/derived/census-nces-crosswalk.csv — ${matched.length} rows`);
say("Provenance: data/derived/census-nces-crosswalk.md");

writeFileSync(
  join(OUT_DIR, "census-nces-crosswalk.report.txt"),
  `${lines.join("\n")}\n`,
  "utf8",
);
