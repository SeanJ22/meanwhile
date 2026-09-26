/**
 * SEMANTICS SHARED BY EVERY REPOSITORY IMPLEMENTATION.
 *
 * The in-memory double and the filesystem store must behave IDENTICALLY on
 * every rule that a test asserts. The cheapest way to guarantee that is to stop
 * writing the rule twice: what lives here is the behaviour, and each provider
 * supplies only the primitive it actually differs in — a `Map` versus an atomic
 * `rename`.
 *
 * A double whose semantics have drifted from the real store is worse than no
 * double: it converts a green suite into positive evidence for a claim the
 * production path does not satisfy. Every rule this file holds is a rule that
 * would otherwise have two chances to drift.
 *
 * Nothing here reads a clock.
 */

import type { BudgetLedger } from "../budget.ts";
import {
  UnknownAggregate,
  type AggregateRepository,
  type BudgetRepository,
  type LockManager,
  type Persisted,
  type PutOutcome,
} from "./types.ts";

/**
 * The shared budget is ONE aggregate under ONE id, forever.
 *
 * Not one per host, not one per worker, not one per session. `budget.ts` states
 * the invariant — twelve workers on one publisher contend on ONE HostBudget —
 * and a store that partitioned the ledger by anything would break that
 * invariant in the storage layer while every unit test above it still passed.
 */
export const BUDGET_AGGREGATE_ID = "shared-budget-ledger";

/**
 * Build the shared-budget repository over any aggregate store and lock manager.
 *
 * `mutate` is the only write path that a scheduler should ever use. It takes the
 * lock, reads, applies the caller's PURE decision function, and compare-and-sets
 * against the revision it just read. Read-decide-write as three separate public
 * calls would let two workers both read `inFlight: 2`, both decide they are
 * under a limit of 3, and both write `inFlight: 3` — which is the arithmetic of
 * fanning out producing exactly the over-fetch the budget exists to prevent.
 */
export function budgetRepositoryFrom(
  aggregate: AggregateRepository<BudgetLedger>,
  locks: LockManager,
  concurrency: "EXCLUSIVE_LOCK" | "ATOMIC_COMPARE_AND_SET" = "EXCLUSIVE_LOCK",
): BudgetRepository {
  const read = async (): Promise<Persisted<BudgetLedger>> => {
    const persisted = await aggregate.read(BUDGET_AGGREGATE_ID);
    if (persisted === null) {
      throw new UnknownAggregate(
        "BudgetLedger",
        `${BUDGET_AGGREGATE_ID} (no shared budget has been installed; an uncharacterised ` +
          "publisher set refuses acquires rather than assuming a politeness nobody recorded)",
      );
    }
    return persisted;
  };

  return {
    read,

    install: (ledger: BudgetLedger, now: string): Promise<PutOutcome<BudgetLedger>> =>
      aggregate.put(BUDGET_AGGREGATE_ID, ledger, now),

    compareAndSet: (
      expectedRevision: number,
      next: BudgetLedger,
      now: string,
    ): Promise<Persisted<BudgetLedger>> =>
      aggregate.compareAndSet(BUDGET_AGGREGATE_ID, expectedRevision, next, now),

    mutate: async <R>(
      mutator: (ledger: BudgetLedger) => { readonly ledger: BudgetLedger; readonly result: R },
      now: string,
    ): Promise<{ readonly result: R; readonly persisted: Persisted<BudgetLedger> }> => {
      const decideAndCommit = async () => {
        const current = await read();
        const decided = mutator(current.value);
        const persisted = await aggregate.compareAndSet(
          BUDGET_AGGREGATE_ID,
          current.revision,
          decided.ledger,
          now,
        );
        return { result: decided.result, persisted };
      };
      // Postgres fences this write in one UPDATE ... WHERE revision statement.
      // HTTP queries do not share a session, so a session advisory lock cannot
      // protect their read/decision/write lifetime. A losing CAS throws before
      // any admission is returned; the caller retries the pure decision.
      return concurrency === "ATOMIC_COMPARE_AND_SET" ? decideAndCommit()
        : locks.withLock(`budget:${BUDGET_AGGREGATE_ID}`, decideAndCommit);
    },
  };
}

/**
 * A JSON round trip, used as the copy boundary in EVERY implementation.
 *
 * The filesystem store gets this for free — it serialises. The in-memory double
 * must do it deliberately, or a caller holding a reference into the store could
 * mutate persisted state without a revision bump, and the double would quietly
 * permit the one thing compare-and-set exists to forbid. Matching the file
 * store's exact lossiness (dropped `undefined`, no Dates, no Maps) is the point,
 * not a side effect: a value that cannot survive the durable store must not
 * survive the double either.
 */
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
