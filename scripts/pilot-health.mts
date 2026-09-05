/**
 * `pnpm pilot:health` — the three contract readings and the rollup
 * (WS-CONTRACT).
 *
 * ## What this printed before (A.1 WI5, 2026-08-30)
 *
 * It called `readerContract` with `activeInstances: 0, evaluatedGreen: 0,
 * evaluatedRed: 0, notEvaluable: 0, target: null` and `truthContract` with
 * `score: null` — literals, every one of them, with a comment promising that
 * "with a corpus present these come from the latest reader-suite run record".
 * Nothing read a run record. Nothing could: none were written with the fields
 * a reading needs.
 *
 * With a NONEMPTY corpus that made READER report **GREEN over zero evaluated
 * instances**, because the red branch tests `evaluatedGreen < activeInstances`
 * and `0 < 0` is false. The contract that governs whether readers can learn
 * anything at all was passing on arithmetic rather than measurement.
 *
 * ## What it reads now, and nothing else
 *
 * The newest canonical run record from each instrument, with its counts, its
 * target, its run id and the SHA it tested. No literal, no default, no
 * assumed zero. Where an instrument has never run, the contract says so and
 * reads NOT_READY — which is a fact about our instrumentation and can never
 * be mistaken for a pass.
 *
 * A record older than the freshness tolerance, or tested on a tree the
 * current HEAD does not contain, is likewise NOT_READY. An old green is
 * evidence about an old day; a green on another tree is evidence about other
 * code. Neither is a reading about now.
 */

import { join } from "node:path";

import {
  freshnessContract,
  freshnessRiskOf,
  pilotHealth,
  readerContract,
  truthContract,
  type ContractReading,
} from "../lib/health/contracts.ts";
import { containsCommit, headSha } from "../lib/ops/git-facts.ts";
import { loadJsonArray } from "../lib/health/json-store.ts";
import {
  assessStaleness,
  latestControlRun,
  latestFreshnessCycle,
  latestReaderRun,
  DEFAULT_MAX_AGE_HOURS,
} from "../lib/health/latest-runs.ts";

const ROOT = process.cwd();

/**
 * How many rows a store holds. Absent is 0 and malformed THROWS — through the
 * shared reader (RULING 103), so the refusal is maintained in one place.
 */
function countLoaded(path: string, what: string): number {
  return (loadJsonArray<unknown>(path, what) ?? []).length;
}

const questionsLoaded = countLoaded(
  join(ROOT, "data", "health", "reader-questions.json"),
  "question templates",
);
const controlsLoaded = countLoaded(
  join(ROOT, "data", "health", "control-facts.json"),
  "control facts",
);

/** Through the shared helper (RULING 103). See `lib/ops/git-facts.ts`. */
const HEAD = headSha();

const now = new Date();

/* ----------------------------------------------------------------- READER */

const readerRun = latestReaderRun(ROOT);
const readerStale =
  readerRun === null
    ? null
    : assessStaleness(readerRun, now, HEAD, containsCommit, DEFAULT_MAX_AGE_HOURS);

const reader = readerContract({
  questionsLoaded,
  activeInstances: readerRun?.instancesActive ?? 0,
  evaluatedGreen: readerRun?.evaluatedGreen ?? 0,
  evaluatedRed: readerRun?.evaluatedRed ?? 0,
  notEvaluable: readerRun?.notEvaluable ?? 0,
  target: readerRun?.target ?? null,
  /*
   * There is currently no independently established zero for the reader
   * universe, and inventing one here is precisely the move this field exists
   * to prevent. It stays null until an enumeration says the zero is real.
   */
  establishedZeroDenominator: null,
  notCurrent:
    readerRun === null
      ? "no canonical reader-suite run record exists yet — run `pnpm reader:suite` against a " +
        "local production build. An unmeasured contract is NOT_READY, never green."
      : (readerStale?.current ?? false)
        ? null
        : `the newest reader-suite run cannot be read as current: ${readerStale?.why}`,
});

/* ------------------------------------------------------------------ TRUTH */

const controlRun = latestControlRun(ROOT);
const controlStale =
  controlRun === null
    ? null
    : assessStaleness(controlRun, now, HEAD, containsCommit, DEFAULT_MAX_AGE_HOURS);

const truth = truthContract({
  controlsLoaded,
  score: controlRun?.score ?? null,
  notCurrent:
    controlsLoaded === 0
      ? null /* AWAITING_OWNER_DATA is the right reading and comes first. */
      : controlRun === null
        ? "no canonical control-set run record exists yet — run `pnpm control:set` against a " +
          "local production build. An unmeasured contract is NOT_READY, never green."
        : (controlStale?.current ?? false)
          ? null
          : `the newest control-set run cannot be read as current: ${controlStale?.why}`,
});

/*
 * FRESHNESS reads the newest cycle's MEASURED risk through the same shared
 * projection `pnpm owner:publish` uses (9.4.26), so the page and this script
 * cannot disagree about the FRESHNESS sentence for one SHA.
 */
const freshness = freshnessContract(freshnessRiskOf(latestFreshnessCycle(ROOT)?.record ?? null));
const rollup = pilotHealth(reader, truth, freshness);

/* ----------------------------------------------------------------- report */

function printReading(reading: ContractReading): void {
  console.log(`  ${reading.contract.padEnd(9)} ${reading.state}`);
  console.log(`            ${reading.reason}`);
}

console.log("pilot:health · the three contracts, each on its own denominator");
console.log(`  HEAD ${HEAD?.slice(0, 8) ?? "unknown"}`);
console.log(
  `  reader run: ${
    readerRun
      ? `${readerRun.runId} · sha ${readerRun.testedSha?.slice(0, 8) ?? "unknown"} · ` +
        `${readerRun.evaluatedGreen}/${readerRun.instancesActive} green · ` +
        `${readerRun.finishedAt} · ${readerRun.path}`
      : "none"
  }`,
);
console.log(
  `  control run: ${
    controlRun
      ? `${controlRun.runId} · sha ${controlRun.testedSha?.slice(0, 8) ?? "unknown"} · ` +
        `${controlRun.finishedAt} · ${controlRun.path}`
      : "none"
  }`,
);
console.log("");
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
