/**
 * `pnpm schools:classify` — independent district or dependent system, for every
 * Census school district (unified, elementary, secondary) nationally.
 *
 * A dependent school system is not a government: it is a department of a city,
 * county or state, with no board a reader elects. The class comes from the
 * Census of Governments' own classification, never from the district's name.
 * A district no match branch reaches is `UNCLASSIFIED` and gets no class
 * definition; guessing INDEPENDENT on a base rate would be a claim about who
 * governs a reader's schools.
 *
 * ```
 * pnpm schools:classify [--tiger=<the directory holding the Census files>]
 * ```
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCensusSchoolIndex } from "../lib/registry/census-school-systems.ts";
import type { MatchBranch } from "../lib/registry/census-school-systems.ts";
import { nationalDivisionIds, type Layer } from "./lib/national-division-ids.mts";

const ROOT = process.cwd();
const TIGER = process.argv.find((a) => a.startsWith("--tiger="))?.slice(8) ?? join(ROOT, ".cache", "tiger");
const SCHOOL_LAYERS: ReadonlySet<Layer> = new Set(["unsd", "elsd", "scsd"]);

/** TIGER fills territory no district covers with a placeholder feature; it is not a district. */
function isPseudo(label: string): boolean {
  return /\b(not defined|unorganized|no unified school district)\b/i.test(label);
}

const postalOf = (ocdId: string): string => (/\/state:([a-z]{2})\b/.exec(ocdId)?.[1] ?? "").toUpperCase();

const index = buildCensusSchoolIndex(ROOT);
const national = nationalDivisionIds(ROOT, TIGER);

const stamp: Record<string, "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED"> = {};
const branchOf: Record<string, MatchBranch> = {};
const byBranch: Record<MatchBranch, number> = {
  EXACT: 0,
  RELAXED: 0,
  NCES_ALIAS: 0,
  PLACE_RELAXED: 0,
  INTERSTATE: 0,
};
let independent = 0;
let dependent = 0;
let unclassified = 0;
let pseudo = 0;
const unmatched: string[] = [];

for (const d of national.divisions.values()) {
  if (!SCHOOL_LAYERS.has(d.layer)) continue;
  if (isPseudo(d.label)) {
    pseudo++;
    continue;
  }
  const hit = index.lookup(d.statefp, d.label);
  if (hit === null) {
    stamp[d.ocdId] = "UNCLASSIFIED";
    unclassified++;
    unmatched.push(`${postalOf(d.ocdId)} ${d.label}`);
    continue;
  }
  stamp[d.ocdId] = hit.kind;
  branchOf[d.ocdId] = hit.branch;
  byBranch[hit.branch]++;
  if (hit.kind === "DEPENDENT") dependent++;
  else independent++;
}

const total = independent + dependent + unclassified;
const out = {
  generator: "pnpm schools:classify (scripts/classify-school-districts.mts)",
  source:
    "Divisions: the 2023 Census cartographic-boundary school district layers (unified, elementary, secondary; ids from scripts/lib/national-division-ids.mts). Class: data/reference/census_govt_units_2022.csv (gov_type = SCHOOL DISTRICT) and data/reference/census_govt_units_2022_dependent_school_systems.csv — the 2022 Census of Governments' own INDEPENDENT/DEPENDENT classification, read directly. data/derived/census-nces-crosswalk.csv supplies NCES name aliases only.",
  note:
    "A district with no match is UNCLASSIFIED and gets no class definition. Guessing INDEPENDENT on a base rate would be a claim about who governs a reader's schools.",
  censusRowsRead: index.counts,
  totals: { total, independent, dependent, unclassified, pseudoEntitiesSkipped: pseudo },
  matchedByBranch: byBranch,
  unmatched,
  branchOf,
  stamp,
};

writeFileSync(
  join(ROOT, "data", "derived", "school-district-dependency.json"),
  `${JSON.stringify(out, null, 2)}\n`,
  "utf8",
);

console.log(`\nschool districts classified — ${independent + dependent} of ${total}\n`);
console.log(`  INDEPENDENT    ${independent}`);
console.log(`  DEPENDENT      ${dependent}`);
console.log(`  UNCLASSIFIED   ${unclassified}`);
console.log(`  pseudo-entities skipped (not districts)  ${pseudo}`);
console.log(`\n  Census rows read — independent ${index.counts.independent}, dependent ${index.counts.dependent}`);
console.log(
  `  matched by branch — EXACT ${byBranch.EXACT}, RELAXED ${byBranch.RELAXED}, NCES_ALIAS ${byBranch.NCES_ALIAS}, PLACE_RELAXED ${byBranch.PLACE_RELAXED}, INTERSTATE ${byBranch.INTERSTATE}`,
);
if (unmatched.length > 0) {
  console.log(`\n  unmatched, all ${unmatched.length} of them:`);
  for (const u of unmatched) console.log(`    ${u}`);
}
