/**
 * `pnpm schools:classify` — **independent district or dependent system, per
 * rendered district.** (DEF-2, 2026-08-22, the author's 8/22 walkthrough, item
 * 11. Rewritten 2026-08-23, item 2.)
 *
 * ## Why this has to be answered before a card can describe a school district
 *
 * `data/reference/` holds **12,546 independent school districts** and **1,313
 * dependent school systems**, and the second kind **are not governments** —
 * they are departments of a city, a county or the state. A card that gave a
 * dependent system the independent definition would tell a reader to go and
 * vote for a school board that does not exist, and to go to a superintendent
 * who answers to a mayor.
 *
 * So each rendered district is STAMPED, and the stamp comes from the Census
 * Bureau's own classification rather than from the district's name.
 *
 * ## What changed on 2026-08-23, and it was a false zero
 *
 * This asked `data/derived/census-nces-crosswalk.csv`, which is the
 * INTERSECTION of the Census and NCES — 9,776 matched pairs. The crosswalk's
 * own report states what it leaves out: **4,083 Census school systems have no
 * NCES match and are therefore absent from it entirely.** Asking the
 * intersection a question only the Census can answer returned `UNCLASSIFIED`
 * for **219 of 514** rendered districts, which read as a gap in the data and
 * was a gap in the lookup.
 *
 * `lib/registry/census-school-systems.ts` now reads the two Census files
 * DIRECTLY, over four one-to-one branches, and keeps the crosswalk for the one
 * thing it is good at — knowing NCES's house style for a system whose Census
 * kind is already established.
 *
 * **A district that no branch reaches is `UNCLASSIFIED`, and an unclassified
 * district gets NO class definition.** That is the deliberate direction to
 * fail: guessing INDEPENDENT because most districts are would be a claim about
 * who governs a reader's schools, made on a base rate. The number is printed,
 * every unmatched district is named, and it is a gap rather than an error.
 *
 * ```
 * pnpm schools:classify
 * ```
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCensusSchoolIndex } from "../lib/registry/census-school-systems.ts";
import type { MatchBranch } from "../lib/registry/census-school-systems.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF: string = today();


const FIPS: Record<string, string> = {};
{
  // State postal → FIPS, read from the crosswalk itself rather than hardcoded:
  // a hand-kept state table is the separator-broken-allowlist defect waiting
  // to happen, and this file already carries both columns on every row.
  const lines = readFileSync(join(ROOT, "data", "derived", "census-nces-crosswalk.csv"), "utf8").split(/\r?\n/);
  const header = lines[0].split(",");
  const iFips = header.indexOf("fips_state");
  const iState = header.indexOf("state");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length > Math.max(iFips, iState) && c[iState]) FIPS[c[iState]] = c[iFips];
  }
}

interface Division {
  ocdId: string;
  divisionType: string;
  label: string;
  state: string;
}
const registry = JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as {
  divisions: Division[];
};

/**
 * TIGER fills territory no district covers with a placeholder feature. It is
 * not a district and must never be classified as one — the same pseudo-entity
 * filter `build-zip-governments.mts` applies, applied here for the same reason.
 */
function isPseudo(label: string): boolean {
  return /\b(not defined|unorganized|no unified school district)\b/i.test(label);
}

const index = buildCensusSchoolIndex(ROOT);

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

for (const d of registry.divisions) {
  if (d.divisionType !== "school_district") continue;
  if (isPseudo(d.label)) {
    pseudo++;
    continue;
  }
  const fips = FIPS[d.state] ?? "";
  const hit = index.lookup(fips, d.label);
  if (hit === null) {
    stamp[d.ocdId] = "UNCLASSIFIED";
    unclassified++;
    unmatched.push(`${d.state} ${d.label}`);
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
  generatedAt: AS_OF,
  generator: "pnpm schools:classify (scripts/classify-school-districts.mts)",
  source:
    "data/reference/census_govt_units_2022.csv (gov_type = SCHOOL DISTRICT) and data/reference/census_govt_units_2022_dependent_school_systems.csv — the 2022 Census of Governments' own INDEPENDENT/DEPENDENT classification, read directly. data/derived/census-nces-crosswalk.csv supplies NCES name aliases only.",
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
  // RULING 105: every one is NAMED. A count of what is still dark is not a
  // list of it, and only the list can be worked next session.
  console.log(`\n  unmatched, all ${unmatched.length} of them:`);
  for (const u of unmatched) console.log(`    ${u}`);
}
