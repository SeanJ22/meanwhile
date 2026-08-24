/**
 * `pnpm bodies:spanning` — find bodies that appear under more than one
 * division under the same name. (RULING 121, Sean's decision of 2026-08-24,
 * closing `NH33`.)
 *
 * A body id is `<ocdId>#<slot>`, which assumed one body sits in one division.
 * A body governing two towns therefore ships as two rows with one name — one
 * body wearing two ids — and every count that walks the registry counts it
 * twice.
 *
 * This is the SWEEP for the class rather than the two named instances (the
 * named-instance rule): every defect this project has found by name has turned
 * out to have siblings.
 *
 * A hit is a CANDIDATE, never an automatic merge. Two towns can genuinely run
 * two separate bodies with identical names — "Board of Selectmen" is the
 * obvious case — so the decision is per pair and it is a person's.
 */
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";

const bodies = CURATED_BODIES;
const byName = new Map<string, typeof bodies>();
for (const b of bodies) {
  if (!b.name) continue;
  const key = b.name.trim().toLowerCase();
  byName.set(key, [...(byName.get(key) ?? []), b]);
}

/**
 * Names so generic that sharing one says nothing. Every town has a select
 * board and they are emphatically different bodies.
 */
const GENERIC =
  /^(board of selectmen|select ?board|town council|city council|school board|board of education|planning board|zoning board|conservation commission|board of adjustment|library trustees|cemetery trustees|budget committee|town clerk|board of assessors|board of health|recreation commission|historic district commission|trustees of the trust funds|supervisors of the checklist|zoning board of adjustment)$/;

let spanning = 0;
let generic = 0;
let alreadyMerged = 0;
const candidates: string[] = [];

for (const [name, group] of byName) {
  if (group.length < 2) continue;
  const divisions = new Set(group.map((b) => b.ocdId));
  if (divisions.size < 2) continue;
  if (GENERIC.test(name)) {
    generic += 1;
    continue;
  }
  spanning += 1;
  candidates.push(
    `  ${group[0].name}\n${group.map((b) => `      ${b.ocdId}`).join("\n")}`,
  );
}

for (const b of bodies) if ((b.alsoServesOcdIds ?? []).length > 0) alreadyMerged += 1;

console.log("BODIES SPANNING MORE THAN ONE DIVISION (RULING 121)");
console.log(`  registry bodies:                 ${bodies.length}`);
console.log(`  distinct names:                  ${byName.size}`);
console.log(`  already merged (alsoServes set): ${alreadyMerged}`);
console.log(
  `  generic names shared across towns: ${generic}  — a select board in two towns is two bodies, not one`,
);
console.log(`  MERGE CANDIDATES:                ${spanning}`);
for (const c of candidates) console.log(c);
if (spanning === 0) {
  console.log("\n  Nothing further of this shape in the registry as it stands TODAY.");
  console.log("  That is one measurement on one date, not a claim that none will appear:");
  console.log("  every new state adds village districts, precincts and regional committees,");
  console.log("  and this is the instrument that finds them (RULING 52).");
}
