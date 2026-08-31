/**
 * **READING THE CANONICAL RUN RECORDS.** (A.1 WI5, 2026-08-30.)
 *
 * ## What `pnpm pilot:health` did instead
 *
 * It called `readerContract` with literals:
 *
 * ```
 *   activeInstances: 0, evaluatedGreen: 0, evaluatedRed: 0,
 *   notEvaluable: 0, target: null
 * ```
 *
 * and `truthContract({ controlsLoaded, score: null })`. The comment beside the
 * zeros said *"with a corpus present these come from the latest reader-suite
 * run record"* — describing a thing that was never built.
 *
 * The consequence is arithmetic, not stylistic. `readerContract` reddens when
 * `evaluatedGreen < activeInstances`. With both hardcoded to zero that is
 * `0 < 0`, which is false, so with a NONEMPTY corpus the contract fell through
 * every red branch and returned **GREEN over zero evaluated instances.** A
 * vacuous green on the contract that governs whether readers can learn
 * anything at all.
 *
 * ## What a reading now requires
 *
 * A run record, on disk, written by the instrument itself. No literal, no
 * default, and no "assume zero". Where no record exists the contract reads
 * NOT_READY with the instrument named — which is true, checkable, and cannot
 * be mistaken for a pass.
 *
 * ## Freshness of the EVIDENCE, which is a different thing from FRESHNESS
 *
 * The FRESHNESS contract is about civic data going stale. This is about the
 * MEASUREMENT going stale, and a green measured a week ago against a tree that
 * is not the deployed one is not evidence about what is deployed. Both a
 * `maxAgeHours` and a SHA-ancestry test apply, and failing either reads
 * NOT_READY rather than green.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ControlScore } from "./control-fact.ts";
import type { EvaluationTarget } from "./reader-question.ts";

/** How old a run record may be and still describe the present. */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** The fields every reading needs, whichever instrument wrote the record. */
export interface RunSummary {
  readonly runId: string;
  readonly testedSha: string | null;
  readonly finishedAt: string;
  readonly path: string;
}

export interface ReaderRunSummary extends RunSummary {
  readonly corpusTemplates: number;
  readonly instancesActive: number;
  readonly evaluatedGreen: number;
  readonly evaluatedRed: number;
  readonly notEvaluable: number;
  readonly target: EvaluationTarget;
  /** True when the independent denominator check actually ran before scoring. */
  readonly denominatorCheckRan: boolean;
  readonly coverageDefects: number;
}

export interface ControlRunSummary extends RunSummary {
  readonly controlsLoaded: number;
  readonly score: ControlScore | null;
}

/**
 * The most recent record in a runs directory, by filename order.
 *
 * Records are `<day>-<NN>.json` and `nextRunRecordPath` numbers them by max+1,
 * so lexical order IS chronological order within a day and across days. Sorted
 * rather than assumed: a directory listing is not ordered by contract.
 */
function latestRecord<T>(dir: string): (T & { path: string }) | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(n))
    .sort();
  const newest = names.at(-1);
  if (!newest) return null;
  const path = join(dir, newest);
  /* A record that cannot be parsed is a FAILED read, never an absent one. The
     throw names the file; a caller that swallowed it would report "no run" for
     a run that happened and whose result we simply could not read. */
  const parsed = JSON.parse(readFileSync(path, "utf8")) as T;
  return { ...parsed, path };
}

export function latestReaderRun(root: string = process.cwd()): ReaderRunSummary | null {
  return latestRecord<ReaderRunSummary>(join(root, "data", "health", "reader-suite-runs"));
}

export function latestControlRun(root: string = process.cwd()): ControlRunSummary | null {
  return latestRecord<ControlRunSummary>(join(root, "data", "health", "control-set-runs"));
}

/* ------------------------------------------------------------ staleness */

export interface StalenessVerdict {
  /** True when the record may be read as describing the present. */
  readonly current: boolean;
  /** Why not, when not. Null when current. */
  readonly why: string | null;
  readonly ageHours: number | null;
}

/**
 * Is this run recent enough, and on a recent enough tree, to be read as now?
 *
 * `releaseSha` is the SHA the reading is being made ABOUT — normally HEAD.
 * A run tested on a commit that HEAD does not contain measured code that is
 * not this code, and that is stale regardless of the clock.
 */
export function assessStaleness(
  run: RunSummary,
  now: Date,
  releaseSha: string | null,
  contains: (ancestor: string, descendant: string) => boolean,
  maxAgeHours: number = DEFAULT_MAX_AGE_HOURS,
): StalenessVerdict {
  const finished = Date.parse(run.finishedAt);
  const ageHours = Number.isNaN(finished) ? null : (now.getTime() - finished) / 3_600_000;

  if (ageHours === null) {
    return { current: false, why: `the run record carries no readable finish time`, ageHours: null };
  }
  if (ageHours > maxAgeHours) {
    return {
      current: false,
      why:
        `the newest run finished ${ageHours.toFixed(1)}h ago, past the ${maxAgeHours}h ` +
        "freshness tolerance — a measurement that old is evidence about then, not now",
      ageHours,
    };
  }
  /*
   * `== null` catches BOTH null and undefined, and the undefined case is real
   * rather than defensive: run records written before this field existed are
   * on disk right now and simply do not carry it. A record from an older
   * schema is UNANCHORED, which is a fact about that record — it may not be
   * read as current, and it may not crash the reading either.
   */
  if (run.testedSha == null) {
    return {
      current: false,
      why:
        "the run record names no tested SHA, so it cannot be placed against the release " +
        "(records written before the field existed read this way, and that is correct)",
      ageHours,
    };
  }
  if (releaseSha !== null && !contains(run.testedSha, releaseSha)) {
    return {
      current: false,
      why:
        `the run tested ${run.testedSha.slice(0, 8)}, which the release ` +
        `${releaseSha.slice(0, 8)} does not contain — it measured different code`,
      ageHours,
    };
  }
  return { current: true, why: null, ageHours };
}
