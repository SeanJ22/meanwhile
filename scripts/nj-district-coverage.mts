/**
 * `pnpm nj:districts` — **did the New Jersey hunt actually finish the school
 * districts, or did it silently skip them?** (`BC-28`, 2026-08-25.)
 *
 * ## Sean's question, and why it deserved an instrument rather than an answer
 *
 * Morris Hills Regional School District renders *We haven't sourced who runs it
 * yet*, and Sean found that hard to believe given New Jersey was supposed to be
 * complete. His instruction was to audit whether the hunt finished or skipped —
 * *if the hunt reported a count it did not deliver, that is a process defect,
 * not a data gap.*
 *
 * That distinction is the whole point. A DATA GAP is a body we tried and could
 * not reach; the response is more hunting. A PROCESS DEFECT is a body that was
 * never in the denominator the hunt reported against; the response is fixing
 * how the hunt counts, because more hunting will miss it again the same way.
 *
 * ## What it measures
 *
 * The official universe for the zip comes from `docs/gap-ledger.md`'s data —
 * the Census of Governments enumeration — never from counting our own registry
 * (the coverage-claims rule). Against it: which bodies hold a ROSTER, split by
 * LAYER, because that is where the answer turned out to be.
 *
 * The floor is RULING 159's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(import.meta.dirname, "..");

interface LedgerBody {
  name?: string;
}
interface Pilot {
  universeGovernments?: number;
  bodiesEnumerated?: number;
  resolvedGovernments?: LedgerBody[];
  unenumerated?: LedgerBody[];
}

/** Is this body a school district by its own published name? */
export function isSchoolBody(name: string): boolean {
  return /school district|board of education|regional (high )?school/i.test(name);
}

export function njDistrictCoverage(root = ROOT) {
  const ledger = JSON.parse(
    readFileSync(join(root, "data", "derived", "gap-ledger.json"), "utf8"),
  ) as { pilots: Record<string, Pilot> };
  const pilot = ledger.pilots["07866"];
  if (!pilot) throw new Error("07866 is not in the gap ledger — nothing can be measured against it");

  const enumerated = [...(pilot.resolvedGovernments ?? []), ...(pilot.unenumerated ?? [])]
    .map((b) => b.name ?? "")
    .filter(Boolean);
  const schoolsInUniverse = enumerated.filter(isSchoolBody);

  const njRosters = BODY_ROSTERS.filter((b) => /state:nj/.test(b.bodyId));
  const njSchoolRosters = njRosters.filter((b) => isSchoolBody(b.bodyName));
  const njMunicipalRosters = njRosters.filter((b) => !isSchoolBody(b.bodyName));

  const withRoster = schoolsInUniverse.filter((name) =>
    njSchoolRosters.some((r) => r.bodyName.toLowerCase().includes(name.toLowerCase().split(" school")[0]!)),
  );

  return {
    universeGovernments: pilot.universeGovernments ?? 0,
    enumerated,
    schoolsInUniverse,
    withRoster,
    dark: schoolsInUniverse.filter((n) => !withRoster.includes(n)),
    njRosters: njRosters.length,
    njSchoolRosters: njSchoolRosters.length,
    njMunicipalRosters: njMunicipalRosters.length,
  };
}

if (import.meta.filename === process.argv[1]) {
  const c = njDistrictCoverage();

  const measured = floored(
    "school districts at 07866 with NO roster",
    "the 07866 gap-ledger enumeration",
    c.schoolsInUniverse.length,
    c.dark.length,
  );

  console.log("BC-28 — New Jersey district coverage, against the OFFICIAL universe\n");
  console.log(`  official universe at 07866      ${c.universeGovernments} government(s)`);
  console.log(`  school districts among them     ${c.schoolsInUniverse.length}`);
  for (const n of c.schoolsInUniverse) {
    console.log(`    ${c.withRoster.includes(n) ? "HAS ROSTER" : "DARK      "}  ${n}`);
  }
  console.log(`\n  ${floorLine(measured)}\n`);
  console.log("  THE PROCESS FINDING — rosters the NJ hunt actually delivered:");
  console.log(`    NJ rosters in the registry      ${c.njRosters}`);
  console.log(`      municipal governing bodies    ${c.njMunicipalRosters}`);
  console.log(`      school boards                 ${c.njSchoolRosters}`);
  console.log(
    "\n  A hunt that returned 22 municipal rosters and 1 school board did not run out of\n" +
      "  reach — it ran a MUNICIPAL enumeration and reported it as New Jersey. That is a\n" +
      "  process defect (the denominator was the wrong universe), not a data gap.",
  );
}
