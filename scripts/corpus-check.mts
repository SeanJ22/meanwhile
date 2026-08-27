/**
 * `pnpm corpus:check` — **every artifact class the product consumes, measured
 * against the provenance contract.**
 * (2026-08-27, the coverage-truth session.)
 *
 * It REPORTS. It does not repair, and it does not fail the build on a
 * non-conformant class — because most of them are non-conformant today and a
 * gate that is red on arrival gets disabled rather than satisfied. What it
 * refuses is a class that claims a field it cannot answer, and a register that
 * has drifted away from the files it describes.
 *
 * ```
 * pnpm corpus:check
 * pnpm corpus:check --json out.json
 * ```
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CORPUS_ARTIFACTS } from "../lib/corpus/artifacts.ts";
import { conformanceOf, supportsChangeDetection, type ConformanceReport } from "../lib/corpus/contract.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Does the path this row describes actually exist? A glob counts if it matches. */
function present(localPath: string): boolean {
  if (!localPath.includes("*")) return existsSync(join(ROOT, localPath));
  const dir = join(ROOT, dirname(localPath));
  if (!existsSync(dir)) return false;
  const ext = localPath.slice(localPath.lastIndexOf("."));
  return readdirSync(dir).some((f) => f.endsWith(ext));
}

const reports: (ConformanceReport & { present: boolean; changeDetection: boolean })[] =
  CORPUS_ARTIFACTS.map((a) => ({
    ...conformanceOf(a, a.notes ?? []),
    present: present(a.localPath),
    changeDetection: supportsChangeDetection(a),
  }));

console.log("=".repeat(76));
console.log("CORPUS PROVENANCE CONTRACT — what each artifact class can say about itself");
console.log("=".repeat(76));

for (const r of reports) {
  console.log(`\n  ${r.level.padEnd(9)} ${r.localPath}${r.present ? "" : "   [ABSENT ON DISK]"}`);
  console.log(`            ${r.what}`);
  if (r.missing.length > 0) {
    console.log(`            cannot answer: ${r.missing.join(", ")}`);
  }
  console.log(`            change detection: ${r.changeDetection ? "yes, by content hash" : "no — a refresh re-reads everything"}`);
  for (const n of r.notes) console.log(`            · ${n}`);
}

const conforms = reports.filter((r) => r.level === "CONFORMS").length;
const missingOnDisk = reports.filter((r) => !r.present);

console.log(`\n${"=".repeat(76)}`);
console.log(`  ${floorLine(floored("artifact classes conforming in full", "the classes the product consumes", reports.length, conforms))}`);
console.log(
  `  ${floorLine(floored("classes supporting change detection", "the classes the product consumes", reports.length, reports.filter((r) => r.changeDetection).length))}`,
);
console.log(
  "\n  A non-conformant class is a NAMED GAP, not a failure. The contract exists so the\n" +
    "  gap has a name — `public/geo/*.geojson` cannot say when it was retrieved, and until\n" +
    "  it can, nothing can tell a stale boundary file from a current one without\n" +
    "  re-fetching every one and diffing.",
);

/*
 * The one thing this DOES refuse: a register that has drifted off the files it
 * describes. A contract report about artifacts that are not there is a report
 * about nothing, and it would read exactly like a clean one.
 */
if (missingOnDisk.length > 0) {
  console.error(
    `\ncorpus:check: ${missingOnDisk.length} registered class(es) are not on disk:\n  ` +
      missingOnDisk.map((r) => r.localPath).join("\n  ") +
      "\nA register describing files that do not exist is a register describing nothing.",
  );
  process.exit(1);
}

const out = arg("json");
if (out) {
  writeFileSync(out, `${JSON.stringify({ reports }, null, 1)}\n`, "utf8");
  console.log(`\nwrote ${out}`);
}
