import type { BudgetLedger } from "../budget.ts";
import {
  ConcurrentModification,
  IdentityCollision,
  UnknownAggregate,
  type AggregateRepository,
  type BudgetRepository,
  type LockManager,
  type Persisted,
  type PutOutcome,
} from "./types.ts";

/** The shared budget is one aggregate under one id: every worker contends on the same ledger. */
export const BUDGET_AGGREGATE_ID = "shared-budget-ledger";

/** `mutate` is the only write path a scheduler should use: lock, read, apply a pure decision, compare-and-set. */
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
      // Postgres fences this write with one UPDATE ... WHERE revision; HTTP queries share no session for an advisory lock.
      // A losing CAS throws before any admission is returned, and the caller retries the pure decision.
      return concurrency === "ATOMIC_COMPARE_AND_SET" ? decideAndCommit()
        : locks.withLock(`budget:${BUDGET_AGGREGATE_ID}`, decideAndCommit);
    },
  };
}

/** A JSON round trip, the copy boundary in every implementation, so no caller holds a reference into the store. */
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** How many lost compare-and-sets one write absorbs before it gives up. */
export const SOLE_WRITER_LOST_RACES = 3;

/**
 * Writes for the one process that owns an aggregate. It remembers the revision it last wrote (or read), writes
 * with a compare-and-set on it, and learns the current revision only from a lost compare-and-set: the row is
 * never read back before a write. `known` is null when the row does not exist, undefined when it was never read
 * (then only its revision is asked for).
 */
export function soleWriter<T>(repo: AggregateRepository<T>, id: string, known: number | null | undefined) {
  let revision = known;
  return async (next: T, now: string): Promise<Persisted<T>> => {
    if (revision === undefined) revision = (await repo.readNarrowed(id, {}))?.revision ?? null;
    for (let lost = 0; ; lost += 1) {
      try {
        const written = revision === null ? (await repo.put(id, next, now)).persisted : await repo.compareAndSet(id, revision, next, now);
        revision = written.revision;
        return written;
      } catch (error) {
        if (lost >= SOLE_WRITER_LOST_RACES) throw error;
        if (error instanceof ConcurrentModification) revision = error.foundRevision;
        else if (error instanceof IdentityCollision) revision = (await repo.readNarrowed(id, {}))?.revision ?? null;
        else throw error;
      }
    }
  };
}
