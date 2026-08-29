/**
 * `pnpm method:promote-portability` — the portability-promotion job.
 * (2026-08-29.)
 *
 * `earnedPortability()` has been correct and unexecuted since the method store
 * was built. This is the thing that executes it, deterministically and
 * idempotently, and reports both numbers against the population it examined
 * rather than announcing a count of its own output (RULING 159).
 *
 * **THE DEFAULT IS A DRY RUN.** Without `--write` nothing is written and the run
 * prints exactly what it would do. That is not caution for its own sake: the job
 * can rewrite applicability on any number of routes at once, and the first thing
 * anybody should be able to do with it is read the list.
 *
 * `--store <path>` points it at a THROWAWAY COPY, so the run can be proved
 * before it ever touches canonical project knowledge.
 */

import { join } from "node:path";

import { runPortabilityPromotion } from "../lib/method/promote-portability.ts";
import { flag, present } from "./cli-args.mts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const STORE = flag(argv, "store") ?? join(ROOT, "data", "method", "knowledge.json");
const WRITE = present(argv, "write");

const run = runPortabilityPromotion(STORE, { stamp: today(), write: WRITE });
for (const line of run.lines) console.log(line);

if (run.refusal) {
  console.error("");
  console.error(run.refusal);
  process.exitCode = 1;
}
