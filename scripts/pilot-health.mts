/**
 * `pnpm pilot:health` — the three contract readings and the rollup
 * (WS-CONTRACT).
 *
 * Prints READER, TRUTH and FRESHNESS from `lib/health/contracts.ts` against
 * the CURRENT data on disk, then the rollup. Each contract is stated
 * individually; the rollup never averages, and no contract certifies another.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  freshnessContract,
  pilotHealth,
  readerContract,
  truthContract,
  type ContractReading,
} from "../lib/health/contracts.ts";

const ROOT = process.cwd();

function countLoaded(path: string, what: string): number {
  if (!existsSync(path)) return 0;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} exists but is not an array of ${what}`);
  }
  return parsed.length;
}

const questionsLoaded = countLoaded(
  join(ROOT, "data", "health", "reader-questions.json"),
  "question templates",
);
const controlsLoaded = countLoaded(
  join(ROOT, "data", "health", "control-facts.json"),
  "control facts",
);

const reader = readerContract({
  questionsLoaded,
  // With a corpus present these come from the latest reader-suite run record;
  // today the corpus is the gate and zero questions means zero instances.
  activeInstances: 0,
  evaluatedGreen: 0,
  evaluatedRed: 0,
  notEvaluable: 0,
  target: null,
});
const truth = truthContract({ controlsLoaded, score: null });
const freshness = freshnessContract();
const rollup = pilotHealth(reader, truth, freshness);

function printReading(reading: ContractReading): void {
  console.log(`  ${reading.contract.padEnd(9)} ${reading.state}`);
  console.log(`            ${reading.reason}`);
}

console.log("pilot:health · the three contracts, each on its own denominator");
for (const reading of rollup.readings) printReading(reading);
console.log(
  `  PILOT HEALTH: ${rollup.green ? "GREEN" : "NOT GREEN"} — green only when all three are ` +
    "green; no contract certifies another",
);
if (!rollup.green) {
  for (const blocker of rollup.blocking) {
    console.log(`    blocking: ${blocker.contract} is ${blocker.state}`);
  }
}
