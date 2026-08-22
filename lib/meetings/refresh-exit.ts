/**
 * The exit-code contract between a refresh script and the workflow that runs
 * it. (NH31, 2026-08-21.)
 *
 * A refresh has three outcomes and until now it had two codes, which is the
 * whole of the defect. `0` meant "clean" and `1` meant everything else — both
 * "nothing was written, there is nothing to commit" and "a good snapshot is
 * sitting on disk and one source of eleven broke". The workflow could not tell
 * those apart, so it treated the second as the first: it stopped at the failed
 * step and never reached its commit, discarding fresh rows from every healthy
 * source because one unhealthy source was in the same run.
 *
 * The arithmetic is why this is structural rather than untidy. With a
 * per-source job-failure rate of p, a run that commits only when NO source
 * fails commits with probability (1 - p)^n. The observed p for the meetings
 * composite is 0.042 — implied by 14 failed runs of 37 across eight days at
 * eleven sources, 1 - 0.622^(1/11). At n = 11 that is a 62% chance of
 * committing, which merely looks flaky. At n = 5000 it is 3e-94, which is
 * never. The corpus stops growing and every run is honestly, uselessly red.
 *
 * So the third outcome gets its own code, and the caller's obligation for it
 * is the opposite of the other failure's: commit first, then go red.
 */

/**
 * Clean. Everything asked was read, the snapshot is written, commit it.
 */
export const EXIT_CLEAN = 0;

/**
 * NOTHING WAS WRITTEN. No snapshot reached disk this run — the composite
 * produced no report, or every source failed and the previous snapshot is
 * being kept deliberately. There is nothing to commit and the caller must not
 * try; the site keeps serving the last good file and says how stale it is.
 */
export const EXIT_NOTHING_WRITTEN = 1;

/**
 * WRITTEN, WITH NAMED JOB FAILURES. A snapshot IS on disk and is better than
 * the committed one: the sources that read are fresh, and the sources that
 * job-failed are recorded as job failures inside it.
 *
 * The caller MUST commit it and MUST then report the run as failed. Both
 * halves are load-bearing. Committing without going red would compile a JOB
 * failure into a skip, which RULING 12 forbids and which is how a broken
 * parser lives for months behind a green light. Going red without committing
 * is NH31 — the failure this code exists to end.
 */
export const EXIT_WRITTEN_WITH_JOB_FAILURES = 2;

/**
 * Whether a caller holding this exit code has a snapshot on disk worth
 * committing. The workflow encodes the same question in bash; this is the
 * definition the suite tests against, so the two cannot drift apart silently.
 */
export function commitsDespiteFailure(exitCode: number): boolean {
  return exitCode === EXIT_WRITTEN_WITH_JOB_FAILURES;
}
