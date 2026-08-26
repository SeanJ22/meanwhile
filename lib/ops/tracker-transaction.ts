/**
 * A TRACKER WRITE IS ONE TRANSACTION, OR IT IS A CORRUPTION.
 * (2026-08-26, the sources-and-incumbency session, Addendum 2 items 3 and 4.)
 *
 * ## What went wrong, exactly
 *
 * `job-watch` run 32996823803 opened `JOB04` and `JOB05`. `scripts/tracker.mjs
 * add` did its whole job in-process: it appended the rows, claimed their ids in
 * `docs/tracker-opened.json`, and regenerated `docs/tracker.md`, `docs/log.md`
 * and `docs/tracker.xlsx` from the store.
 *
 * **Then the workflow committed one fifth of it.** Its allowlist profile
 * granted exactly `docs/tracker-working.csv`, so the store landed on `main` and
 * the four derived artifacts were discarded with the runner. The result is a
 * store that permanently disagrees with its own views, and four guards in
 * `tests/tracker-stores.test.ts` went red on `main`:
 *
 *   - Needs Sean holds 7 P1 rows and `tracker.md` does not say the section is stopped
 *   - the stated open count is not the store's
 *   - `tracker.md` states an open count other than 288
 *   - `JOB04` and `JOB05` are in a store and no ledger entry claims them
 *
 * **Every one of those tests is correct and none of them is loosened.** They
 * caught real corruption, which is what they are for.
 *
 * **AND THE ATOMIC WRITER IS NOT ON ITS OWN A FIX.** This is the part worth
 * writing down: while the profile grants one path of five, making the write
 * transactional changes nothing — the transaction cannot COMMIT. The profile
 * had to be resolved path-by-path first (`lib/ops/push-allowlist.ts`,
 * `TRACKER_VIEW_GRANTS`), and this is the half that stops the next divergence
 * from being silent.
 *
 * ## What this module is
 *
 * The RECONCILIATION ASSERTION at the end of the transaction. The write itself
 * already happens in one process; what was missing is anything that reads the
 * result back and refuses when the parts do not agree. A step that reports
 * success with its product unchecked is RULING 113, and this is that ruling
 * applied to the tracker's own writer.
 *
 * It is pure — it takes what was read from disk and returns a verdict — so the
 * regression test can construct a divergence without a filesystem.
 */

/** The state a completed tracker transaction must leave behind. */
export interface TrackerState {
  /** Every id in the working store, in order, so a duplicate is visible. */
  readonly workingIds: readonly string[];
  /** Every id any ledger entry claims. */
  readonly claimedIds: readonly string[];
  /** The open count `docs/tracker.md` states about itself. */
  readonly statedOpenCount: number | null;
  /** P1 rows in the Needs Sean section, from the STORE. */
  readonly needsSeanP1: number;
  /** Does `docs/tracker.md` mark Needs Sean as stopped? */
  readonly trackerMdSaysStopped: boolean;
  /** Was `docs/log.md` written in this transaction? */
  readonly logRegenerated: boolean;
}

export const P1_CAP = 5;

export interface ReconciliationFailure {
  readonly check: string;
  readonly detail: string;
}

/**
 * Every way the transaction can have half-completed. ALL of them are reported,
 * never the first (RULING 164) — a half-write usually breaks more than one
 * invariant, and naming one sends the reader back for a second round.
 */
export function reconcileTracker(
  state: TrackerState,
  addedIds: readonly string[],
): ReconciliationFailure[] {
  const out: ReconciliationFailure[] = [];

  // 1. The row landed, exactly once.
  for (const id of addedIds) {
    const n = state.workingIds.filter((x) => x === id).length;
    if (n === 0) {
      out.push({ check: "row-landed", detail: `${id} is not in the working store after the write` });
    } else if (n > 1) {
      out.push({
        check: "row-unique",
        detail: `${id} appears ${n} times — a tracker with two rows per id cannot be read by anything`,
      });
    }
  }

  // 2. The ledger claims it. This is the assertion JOB04 and JOB05 failed.
  const claimed = new Set(state.claimedIds);
  const unclaimed = addedIds.filter((id) => !claimed.has(id));
  if (unclaimed.length > 0) {
    out.push({
      check: "ledger-claims-the-row",
      detail:
        `${unclaimed.join(", ")} reached a store with no session ledger entry claiming them. ` +
        "A row nobody claims is a row that arrived without going through `tracker add`.",
    });
  }

  // 3. The generated view states the store's own count.
  const open = state.workingIds.length;
  if (state.statedOpenCount === null) {
    out.push({
      check: "views-state-a-count",
      detail: "docs/tracker.md states no open count at all, so it cannot be reconciled against the store",
    });
  } else if (state.statedOpenCount !== open) {
    out.push({
      check: "views-match-the-store",
      detail:
        `docs/tracker.md states ${state.statedOpenCount} open row(s) and the store holds ${open}. ` +
        "The store and its views were written in the same call, so a difference means only part of " +
        "that call was kept.",
    });
  }

  // 4. The section's P1 state is represented, in the direction the cap runs.
  if (state.needsSeanP1 > P1_CAP && !state.trackerMdSaysStopped) {
    out.push({
      check: "p1-cap-represented",
      detail:
        `Needs Sean holds ${state.needsSeanP1} P1 row(s), over the cap of ${P1_CAP}, and docs/tracker.md ` +
        "does not mark the section stopped (RULING 30). The cap is never satisfied by demotion, so the " +
        "representation is what has to move.",
    });
  }

  // 5. The derived documents were actually regenerated.
  if (!state.logRegenerated) {
    out.push({
      check: "log-regenerated",
      detail: "docs/log.md was not regenerated in this transaction, so the session record is behind the store",
    });
  }

  return out;
}

/** One line per failure, written to be read by somebody not looking for it. */
export function reconciliationReport(failures: readonly ReconciliationFailure[]): string {
  if (failures.length === 0) return "  reconciled             the store, its ledger and its views agree";
  return [
    "",
    "  THE TRACKER TRANSACTION DID NOT COMPLETE.",
    "",
    ...failures.flatMap((f) => [`    [${f.check}]`, `      ${f.detail}`]),
    "",
    "  The store, its ledger and its generated views are written in ONE call and must land in ONE",
    "  commit. If this is a workflow, check that its profile in lib/ops/push-allowlist.ts grants",
    "  every path the call writes — granting the store alone is what put `main` red on 2026-08-26.",
    "",
  ].join("\n");
}
