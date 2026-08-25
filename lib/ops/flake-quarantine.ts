/**
 * **`NH176` — A SUITE THAT FAILS ONE ARBITRARY CHECK PER RUN TEACHES A SESSION
 * TO SKIM PAST THE REAL ONE.** (2026-08-25, Item 13.)
 *
 * Measured 2026-08-25 against ONE local production build, four consecutive
 * runs, with no code and no data changing between them. Every run: 372 passed,
 * 6 declared COULD NOT RUN, and exactly ONE failure — a different one each
 * time.
 *
 *   run 1  `[promptD]` the schema check — REAL and deterministic; the local
 *          Neon branch was at 19 of 21 migrations. It has passed on every run
 *          since it was applied.
 *   run 2  `[g12]` an exact name navigates and asks nothing at 07866 —
 *          the IDENTICAL string that PASSED in run 1.
 *   run 3  `[g5]` north Tucson renders crisp at city zoom.
 *   run 4  `[g12]` again, at 03255 this time.
 *
 * **Why this is a P1 rather than an annoyance.** The whole premise of the walk
 * is that a failure is a NAMED REGRESSION — *the win `<session>` shipped is
 * undone* — and every session is required to run it and report the result. A
 * suite that fails one arbitrary check per run teaches a session to look at the
 * failure, decide it is probably the flaky kind, and move on. That is the
 * failure `CLAUDE.md` names most often, arriving through the instrument built
 * to prevent it, and it means the ONE deterministic failure in run 1 could just
 * as easily have been shrugged off.
 *
 * ## Detection is RERUN-BASED, and it has to be
 *
 * A check cannot be classified from one run. The evidence that separates a
 * flake from a regression is *fails, then passes, with nothing changed* — so
 * the classifier reads N runs of the SAME build and asks what each check did
 * across them. Anything less is a guess about which failures matter, which is
 * the guess this row exists to stop anyone making.
 *
 * ## What quarantine is, and what it deliberately is NOT
 *
 * A quarantined check is **tracked and hunted, never deleted and never counted
 * passing.** It carries a tracker row and it keeps running. The whole value of
 * the walk is that a check leaves it only when the author retires the claim
 * behind it, and a flake is not a retirement — it is a check whose ASSERTION is
 * sound and whose measurement is not yet reliable.
 *
 * So `QUARANTINED` is its own outcome beside `ok`, `FAIL` and `COULD NOT RUN`.
 * Four states, four different facts, and none of them is allowed to wear
 * another's clothes (RULING 24).
 */

export type RunOutcome = "PASS" | "FAIL" | "COULD_NOT_RUN";

/** What one check did across N runs of one unchanged build. */
export interface CheckHistory {
  identity: string;
  outcomes: RunOutcome[];
}

export type Classification =
  /** Failed in every run that could run it. A real, deterministic failure. */
  | "REAL"
  /** Failed at least once and passed at least once. The flake. */
  | "FLAKY"
  /** Passed every time it ran. */
  | "HEALTHY"
  /** Never actually ran. Not a verdict about the check (RULING 24). */
  | "NEVER_RAN";

export interface Verdict {
  identity: string;
  classification: Classification;
  passes: number;
  failures: number;
  couldNotRun: number;
}

/**
 * Classify one check from its history.
 *
 * **A single run can never produce `FLAKY`.** One failure is a failure; it
 * takes a PASS on the same unchanged tree to make it a flake, and that is the
 * whole evidentiary basis of this instrument. Reading a lone failure as
 * probably-flaky is exactly the habit `NH176` was opened over.
 */
export function classify(history: CheckHistory): Verdict {
  const passes = history.outcomes.filter((o) => o === "PASS").length;
  const failures = history.outcomes.filter((o) => o === "FAIL").length;
  const couldNotRun = history.outcomes.filter((o) => o === "COULD_NOT_RUN").length;

  let classification: Classification;
  if (passes === 0 && failures === 0) classification = "NEVER_RAN";
  else if (failures === 0) classification = "HEALTHY";
  else if (passes === 0) classification = "REAL";
  else classification = "FLAKY";

  return { identity: history.identity, classification, passes, failures, couldNotRun };
}

/** Every check, classified, from N runs given as identity→outcome maps. */
export function classifyRuns(runs: Map<string, RunOutcome>[]): Verdict[] {
  const identities = new Set<string>();
  for (const run of runs) for (const id of run.keys()) identities.add(id);

  return [...identities]
    .sort()
    .map((identity) =>
      classify({
        identity,
        outcomes: runs.flatMap((run) => {
          const outcome = run.get(identity);
          /*
           * A check ABSENT from a run is not a check that passed. It did not
           * run — which is a different fact, and folding it into PASS is how a
           * check that stopped existing would read as healthy forever.
           */
          return outcome ? [outcome] : [];
        }),
      }),
    );
}

/** The committed quarantine list. */
export interface QuarantineEntry {
  identity: string;
  /** The tracker row that hunts it. A quarantine with no row is a deletion. */
  row: string;
  /** When it was quarantined. A quarantine is a measurement and carries a date. */
  since: string;
  /** The evidence: what it did across the runs that classified it. */
  evidence: string;
}

export interface QuarantineFile {
  note: string;
  entries: QuarantineEntry[];
}

/**
 * Is this check quarantined?
 *
 * Exact identity match, never a prefix or a fuzzy one. A quarantine that
 * matched loosely would silence checks nobody chose to silence, which is a
 * strictly worse failure than the flake it was suppressing.
 */
export function isQuarantined(file: QuarantineFile | null, identity: string): boolean {
  return (file?.entries ?? []).some((e) => e.identity === identity);
}

/**
 * **A QUARANTINED CHECK IS NEVER COUNTED AS PASSING**, and this is the function
 * that makes that true rather than a promise in a comment.
 *
 * It returns the four-way outcome a run should report, so a caller cannot
 * accidentally add a quarantined failure to its pass count — the only way to
 * get a `PASS` out of here is for the check to have actually passed.
 */
export function outcomeFor(
  file: QuarantineFile | null,
  identity: string,
  ok: boolean,
): "PASS" | "FAIL" | "QUARANTINED" {
  if (ok) return "PASS";
  return isQuarantined(file, identity) ? "QUARANTINED" : "FAIL";
}
