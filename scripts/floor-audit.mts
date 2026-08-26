/**
 * `pnpm floor:audit` — **which counting scripts can report a zero they never
 * earned?** (RULING 159, 2026-08-25.)
 *
 * ## What it looks for, and why it looks for a SHAPE
 *
 * The defect is not a string and cannot be grepped for (RULING 110). It is a
 * script that computes a number from a collection and prints it, where the
 * collection being EMPTY and the collection being CLEAN produce the same
 * output. `0 offenders` is the same six characters whether the sweep found
 * nothing wrong or never opened the page.
 *
 * So the shape is: **a count reported to the reader, whose population is not
 * floored.** Concretely —
 *
 * - the file prints a number that came from `.length`, a `.filter(…).length`,
 *   a `Map`/`Set` `.size`, or a counter variable, AND
 * - the file does not import `lib/ops/denominator-floor.ts`, AND
 * - the file does not otherwise refuse an empty population — a `throw` or a
 *   `process.exit` guarded on a zero/empty test counts, because a hand-written
 *   floor is still a floor and this audit is not a campaign for one import.
 *
 * ## The audit floors ITSELF, which is the point
 *
 * If the sweep matches no files at all it THROWS. An audit that can report
 * `0 scripts lack a floor` because its own glob found nothing is the exact
 * failure it exists to catch, and it would be the fourth venue for it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const ROOT = join(import.meta.dirname, "..");

/** Directories a counting instrument can live in. */
const ROOTS = ["scripts", "lib/ops", "lib/hunt"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mts|ts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Does this file report a count to a reader? */
const REPORTS_A_COUNT = [
  // `[\s\S]` rather than the `s` (dotAll) flag: this repo's tsconfig targets
  // below ES2018, where `/s` is a compile error — the kind of detail that
  // only surfaces once the build type-checks `scripts/` (RULING 76).
  /console\.log\([^)]*\$\{[\s\S]*?\.length/,
  /console\.log\([^)]*\$\{[\s\S]*?\.size\b/,
  /console\.log\([^)]*\.length[^)]*\)/,
  /console\.log\([^)]*\bcount\b/,
];

/** Does it already refuse an empty population, by any mechanism? */
function hasFloor(src: string): { floored: boolean; how: string } {
  if (/denominator-floor/.test(src)) return { floored: true, how: "denominator-floor" };
  // A hand-written refusal: a throw or a non-zero exit reached from an
  // emptiness test. Deliberately generous — the ruling asks for a floor, not
  // for this module.
  if (
    /(?:length|size)\s*===?\s*0[\s\S]{0,220}?\bthrow\b/.test(src) ||
    /\blength\b\s*<\s*1[\s\S]{0,220}?\bthrow\b/.test(src) ||
    /!\w+\.length[\s\S]{0,160}?\bthrow\b/.test(src) ||
    /(?:length|size)\s*===?\s*0[\s\S]{0,220}?process\.exit\(\s*[1-9]/.test(src) ||
    /*
     * **A COUNTER COMPARED AGAINST AN EXPECTED MINIMUM, then thrown on.**
     * (Widened 2026-08-26.)
     *
     * The capture scripts do exactly what this ruling asks and the first
     * version of this detector could not see it: `if (indentTotal < 3 * 4)
     * throw` and `if (shots !== VIEWPORTS.length * 2) throw` are floors —
     * better ones than an emptiness test, because they refuse a PARTIAL
     * measurement and not only an empty one (RULING 100).
     *
     * **Recognising them was the right move rather than adding those files to
     * the baseline**, which only shrinks: a baseline grown to accommodate a
     * blind detector records the blindness as though it were the state of the
     * repo.
     */
    /\b\w+\s*(?:<|!==|!=)\s*[^;\n]{1,40}\)\s*\{?\s*(?:\n\s*)?throw\b/.test(src)
  ) {
    return { floored: true, how: "hand-written refusal" };
  }
  return { floored: false, how: "" };
}

export interface FloorAuditRow {
  file: string;
  reportsCount: boolean;
  floored: boolean;
  how: string;
}

export function auditFloors(root = ROOT): FloorAuditRow[] {
  const files: string[] = [];
  for (const r of ROOTS) walk(join(root, r), files);
  const rows: FloorAuditRow[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const reportsCount = REPORTS_A_COUNT.some((re) => re.test(src));
    if (!reportsCount) continue;
    const { floored: fl, how } = hasFloor(src);
    rows.push({ file: relative(root, f).replace(/\\/g, "/"), reportsCount, floored: fl, how });
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

if (import.meta.filename === process.argv[1]) {
  const rows = auditFloors();
  const missing = rows.filter((r) => !r.floored);

  // The audit's OWN floor. A glob that matched nothing would otherwise print a
  // clean "0 lack a floor" — RULING 159's failure, committed by its instrument.
  const measured = floored(
    "counting scripts WITHOUT a denominator floor",
    "scripts/, lib/ops/, lib/hunt/",
    rows.length,
    missing.length,
  );

  console.log(`floor audit (RULING 159) — ${ROOTS.join(", ")}\n`);
  console.log(`  ${floorLine(measured)}\n`);
  if (missing.length > 0) {
    console.log("  WITHOUT a floor:");
    for (const r of missing) console.log(`    ${r.file}`);
  }
  const withFloor = rows.filter((r) => r.floored);
  console.log(`\n  WITH a floor (${withFloor.length}):`);
  for (const r of withFloor) console.log(`    ${r.file}  [${r.how}]`);
}
