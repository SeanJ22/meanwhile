/**
 * **HOW MANY BODIES CAN THE PRODUCT DESCRIBE?** — DEF-1 to DEF-4 and LBL-1,
 * measured. (2026-08-23, the Discovery Conduct session, Part 2 items 11 and 15.)
 *
 * Committed under RULING 76, and it is not a one-shot: it takes no date, no zip
 * and no session in its name's meaning — re-running it after any definition is
 * added prints the new coverage. The dated filename is the convention, not a
 * limit on when it is useful.
 *
 * Two questions, both with denominators, because a coverage number without one
 * is not a measurement:
 *
 * 1. **N of M rendered bodies carry a CLASS definition**, and N of M carry a
 *    FORM-SPECIFIC one. A body with neither is a card that still cannot say
 *    what the body does, which is the defect DEF-1 to DEF-4 exist to close.
 * 2. **N of M cards suppress the "Who runs it" field** under LBL-1 — nobody
 *    runs a congressional district and nobody runs a U.S. Senate seat, so the
 *    field is REMOVED there rather than renamed.
 *
 * ```
 * pnpm exec tsx scripts/measure-definitions-0823.mts
 * ```
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import type { BodyDivisionType } from "../lib/officials/body-description.ts";
import { schoolDependency } from "../lib/officials/school-dependency.ts";
import { runsSomething } from "../lib/officials/top-offices.ts";

interface Division {
  ocdId: string;
  divisionType: string;
  label: string;
  lsad: string | null;
}
interface Body {
  id: string;
  ocdId: string | null;
  name: string | null;
  coverageStatus: string;
}

const registry = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
) as { divisions: Division[]; bodies: Body[] };

const byId = new Map(registry.divisions.map((d) => [d.ocdId, d]));

let withClass = 0;
let withForm = 0;
let withNeither = 0;
let runsField = 0;
let suppressed = 0;
const missingByType = new Map<string, number>();

/*
 * Every BODY, not every division: a division with no body is not a card, and
 * counting divisions would state a denominator no reader ever meets.
 */
const bodies = registry.bodies.filter((b) => b.ocdId !== null && byId.has(b.ocdId));

for (const body of bodies) {
  const division = byId.get(body.ocdId as string) as Division;
  const definitions = definitionsForBody({
    bodyId: body.id,
    ocdId: division.ocdId,
    divisionType: division.divisionType as BodyDivisionType,
    lsad: division.lsad,
    schoolDependency: schoolDependency(division.ocdId),
  });
  if (definitions.classDefinition) withClass++;
  if (definitions.formDefinition) withForm++;
  if (!definitions.classDefinition && !definitions.formDefinition) {
    withNeither++;
    missingByType.set(division.divisionType, (missingByType.get(division.divisionType) ?? 0) + 1);
  }
}

/* ========================================================================== *
 * DATA-4 (2026-08-28) — THE DENOMINATOR, BOTH WAYS, BECAUSE ONE OF THEM LIED.
 *
 * The line above this block used to read `1,256 of 1,256` and it was a true
 * count of a population that EXCLUDED A THIRD OF THE BODIES: 742 of the 1,998
 * have no division at all, and were filtered out one line before the number was
 * taken. A coverage figure whose denominator is chosen by the same filter that
 * produces the numerator cannot go below 100%, which is what a completeness
 * number is for.
 *
 * So both are printed, always, and the wider one is printed FIRST — the reader
 * of this script is deciding what is still owed, and 742 bodies nobody can
 * describe is the larger part of that answer.
 * ========================================================================== */
const ALL = registry.bodies.length;
const noDivision = registry.bodies.filter((b) => b.ocdId === null);
const describedOverAll = registry.bodies.filter((b) => {
  const division = b.ocdId === null ? null : (byId.get(b.ocdId) ?? null);
  const definitions = definitionsForBody({
    bodyId: b.id,
    ocdId: b.ocdId,
    // A body with no division has no division type. `"place"` here would be the
    // placeholder the class guard exists to refuse, so it is passed only where
    // a real division was found.
    divisionType: (division?.divisionType ?? "place") as BodyDivisionType,
    lsad: division?.lsad ?? null,
    schoolDependency: b.ocdId === null ? undefined : schoolDependency(b.ocdId),
  });
  return definitions.classDefinition !== null || definitions.formDefinition !== null;
});
const liveUndescribed = registry.bodies.filter((b) => {
  if (b.coverageStatus !== "LIVE") return false;
  return !describedOverAll.includes(b);
});

/*
 * **LBL-1 IS MEASURED OVER DIVISIONS, NOT BODIES, and the first version of this
 * script got that wrong.**
 *
 * It counted over bodies and reported 0 of 1,253 suppressed, which reads as
 * "the fix does nothing". It does nothing THERE: a congressional district and a
 * state legislative seat have no BODY row at all, so a body-shaped denominator
 * cannot contain the cards the rule is about. The "Who runs it" field renders on
 * the DISTRICT card, and that is the population.
 */
for (const division of registry.divisions) {
  if (runsSomething(division.divisionType)) runsField++;
  else suppressed++;
}

const M = bodies.length;

console.log(`\nTHE HONEST DENOMINATOR, BOTH WAYS (DATA-4)\n`);
console.log(`  every body in the registry                     ${ALL}`);
console.log(
  `    carrying ANY definition                     ${describedOverAll.length} of ${ALL}  (${((describedOverAll.length / ALL) * 100).toFixed(1)}%)`,
);
console.log(
  `    with NO division at all, so no class layer  ${noDivision.length} of ${ALL}  (${((noDivision.length / ALL) * 100).toFixed(1)}%)`,
);
console.log(
  `  LIVE bodies a reader can reach with NO definition at all   ${liveUndescribed.length}`,
);
for (const body of liveUndescribed.slice(0, 12)) {
  console.log(`      ${body.name ?? body.id}`);
}
if (liveUndescribed.length > 12) console.log(`      … and ${liveUndescribed.length - 12} more`);

console.log(`\nbodies with a division, across the whole registry: ${M}\n`);
console.log(`  carrying a CLASS definition          ${withClass} of ${M}`);
console.log(`  carrying a FORM-SPECIFIC definition  ${withForm} of ${M}`);
console.log(`  carrying NEITHER                     ${withNeither} of ${M}`);
if (withNeither > 0) {
  console.log(`\n  the bodies with neither, by division type:`);
  for (const [type, n] of [...missingByType].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${type}`);
  }
}
console.log(`\nLBL-1 — the "Who runs it" field:`);
console.log(`  renders (the office runs a governing entity)  ${runsField} of ${registry.divisions.length}`);
console.log(`  SUPPRESSED (nobody runs a district or a seat) ${suppressed} of ${registry.divisions.length}`);
