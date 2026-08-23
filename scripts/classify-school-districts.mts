/**
 * `pnpm schools:classify` — **independent district or dependent system, per
 * rendered district.** (DEF-2, 2026-08-22, the author's 8/22 walkthrough, item
 * 11.)
 *
 * ## Why this has to be answered before a card can describe a school district
 *
 * `data/reference/` holds **19,711 independent LEAs** and **1,313 dependent
 * school systems**, and the second kind **are not governments** — they are
 * departments of a city, a county or the state. A card that gave a dependent
 * system the independent definition would tell a reader to go and vote for a
 * school board that does not exist, and to go to a superintendent who answers
 * to a mayor.
 *
 * So each rendered district is STAMPED, and the stamp comes from the Census
 * Bureau's own classification rather than from the district's name.
 *
 * ## The join, and where it refuses
 *
 * `data/derived/census-nces-crosswalk.csv` already carries `census_kind` —
 * INDEPENDENT or DEPENDENT — for 9,776 systems, keyed `FIPS|NORMALIZED NAME`.
 * This matches the registry's school-district divisions against it on state and
 * normalized name.
 *
 * **A district that does not match is `UNCLASSIFIED`, and an unclassified
 * district gets NO class definition.** That is the deliberate direction to
 * fail: guessing INDEPENDENT because most districts are would be a claim about
 * who governs a reader's schools, made on a base rate. The number of
 * unclassified districts is printed, and it is a gap rather than an error.
 *
 * ```
 * pnpm schools:classify
 * ```
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { schoolNameKey } from "../lib/registry/school-name-key.ts";
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

interface CrossRow {
  kind: "INDEPENDENT" | "DEPENDENT";
  name: string;
}
const byKey = new Map<string, CrossRow>();
{
  const lines = readFileSync(join(ROOT, "data", "derived", "census-nces-crosswalk.csv"), "utf8").split(/\r?\n/);
  const header = lines[0].split(",");
  const iName = header.indexOf("census_unit_name");
  const iKind = header.indexOf("census_kind");
  const iFips = header.indexOf("fips_state");
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length <= Math.max(iName, iKind, iFips)) continue;
    const kind = c[iKind] === "DEPENDENT" ? "DEPENDENT" : "INDEPENDENT";
    byKey.set(schoolNameKey(c[iFips], c[iName]), { kind, name: c[iName] });
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

const stamp: Record<string, "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED"> = {};
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
  const hit = byKey.get(schoolNameKey(fips, d.label));
  if (hit === undefined) {
    stamp[d.ocdId] = "UNCLASSIFIED";
    unclassified++;
    unmatched.push(`${d.state} ${d.label}`);
    continue;
  }
  stamp[d.ocdId] = hit.kind;
  if (hit.kind === "DEPENDENT") dependent++;
  else independent++;
}

const total = independent + dependent + unclassified;
const out = {
  generatedAt: AS_OF,
  generator: "pnpm schools:classify (scripts/classify-school-districts.mts)",
  source:
    "data/derived/census-nces-crosswalk.csv — the 2022 Census of Governments' own INDEPENDENT/DEPENDENT classification",
  note:
    "A district with no match is UNCLASSIFIED and gets no class definition. Guessing INDEPENDENT on a base rate would be a claim about who governs a reader's schools.",
  totals: { total, independent, dependent, unclassified, pseudoEntitiesSkipped: pseudo },
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
if (unmatched.length > 0) {
  console.log(`\n  unmatched (first 15 of ${unmatched.length}):`);
  for (const u of unmatched.slice(0, 15)) console.log(`    ${u}`);
}
