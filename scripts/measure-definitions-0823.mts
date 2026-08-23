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
import type { BodyDivisionType } from "../lib/officials/body-blurbs.ts";
import { schoolDependency } from "../lib/officials/school-dependency.ts";
import { runsSomething } from "../lib/officials/top-offices.ts";

interface Division {
  ocdId: string;
  divisionType: string;
  label: string;
  lsad: string | null;
}
interface Body {
  ocdId: string | null;
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
