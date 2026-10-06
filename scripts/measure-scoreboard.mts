/** Measure coverage scoreboard. Missing depth remains work, never a publication hold. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MEASURE_FIELDS,
  scoreMeasure,
  type MeasureReading,
  type MeasureScore,
} from "../lib/hunt/measure-depth.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();

/**
 * Where a measure reading lives.
 *
 * A committed JSON corpus rather than a database table, for the reason RULING
 * 126 gives about campaign finance: this data renders for readers and never
 * enters anything sold, so it lives in the reader-content corpus and not in
 * Postgres where the sold stores are.
 */
const CORPUS = join(ROOT, "data", "measures", "readings.json");

function load(): MeasureReading[] {
  if (!existsSync(CORPUS)) return [];
  try {
    const parsed = JSON.parse(readFileSync(CORPUS, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as MeasureReading[]) : [];
  } catch (err) {
    throw new Error(`MEASURES REFUSED — ${CORPUS} could not be parsed: ${(err as Error).message}`);
  }
}

function main(): void {
  const stamp = today();
  const readings = load();

  if (readings.length === 0) {
    /*
     * RULING 159, and this is the honest empty rather than a clean board.
     *
     * The standard exists and the corpus does not. Printing "0 measures, all
     * done" would be the partial that reconciles — a green number about a
     * population nobody has assembled.
     */
    console.error(
      "MEASURE SCOREBOARD — NOTHING TO SCORE, and that is the finding.\n\n" +
        `  corpus   ${CORPUS}\n` +
        `  holds    ${existsSync(CORPUS) ? "0 reading(s)" : "does not exist"}\n\n` +
        "  The measure STANDARD shipped 2026-08-26 (lib/hunt/measure-depth.ts) and the CORPUS has not\n" +
        "  been assembled. Zero is a result that must be EARNED (RULING 159): this run exits non-zero\n" +
        "  rather than printing a green board about a population nobody has built.\n\n" +
        "  Known to exist and not yet captured:\n" +
        "    · Vail Unified School District — Override Reauthorization 2026 (does not appear at 85641)\n" +
        "    · Pima County Propositions 418 and 419 — Regional Transportation, a MARCH 2026 ballot\n",
    );
    process.exitCode = 1;
    return;
  }

  const scores: MeasureScore[] = readings.map((r) => scoreMeasure(r, stamp));

  /*
   * THE SHARED FLOOR, not a hand-rolled one.
   *
   * The empty case above already refuses, so this can never throw here — and it
   * is used anyway, because `tests/denominator-floor.test.ts` caught this script
   * reporting a count with no floor and it was RIGHT to. A second private
   * implementation of the same guard is RULING 103's duplicate, and the whole
   * value of a shared floor is that one instrument can find every counting site
   * in the repo. Rolling my own would have made this script invisible to it.
   */
  const board = floored("measures scored", CORPUS, readings.length, scores.length);
  const done = scores.filter((s) => s.verdict === "DONE").length;
  const owed = scores.filter((s) => s.verdict === "OWED").length;
  const blocked = scores.filter((s) => s.verdict === "ASYMMETRIC_COVERAGE");

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ measuredOn: stamp, scores }, null, 2));
    return;
  }

  console.log(`\nmeasure scoreboard — ${stamp}\n`);
  for (const s of scores) {
    const r = readings.find((x) => x.measureId === s.measureId);
    console.log(
      `  ${s.verdict.padEnd(19)} ${String(s.satisfied).padStart(2)}/${s.total}  ${s.measureId}  ${r?.title ?? ""}`,
    );
    if (s.owed.length > 0) console.log(`      owed: ${s.owed.join(", ")}`);
    if (!s.symmetry.symmetric) console.log(`      COVERAGE: ${s.symmetry.reason}`);
  }

  console.log(`\n  ${floorLine(board)}`);
  console.log(
    `  ${done} DONE · ${owed} OWED · ${blocked.length} ASYMMETRIC_COVERAGE of ${scores.length}\n`,
  );
  if (blocked.length > 0) {
    console.log(
      "  ASYMMETRIC_COVERAGE shows unfinished work on one side. Every verified fact still publishes.\n",
    );
  }
  console.log(`  the standard is ${MEASURE_FIELDS.length} fields: ${MEASURE_FIELDS.join(", ")}\n`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
