/**
 * **THE DELETION ITSELF.** (`T10`, approved by Sean 2026-08-24.)
 *
 * Separated from the decision in `lib/ops/demo-window.ts` on purpose. That
 * module decides WHETHER and OVER WHAT WINDOW, and is pure, so the decision
 * can be tested without a database. This one only executes a decision already
 * made.
 *
 * ## What it deletes, and what it cannot touch
 *
 * Rows in the two sold stores whose `occurred_at` falls inside the demo
 * window. Nothing else — no schema change, no cascade, no other table. The
 * n-stores-never-join rule means there is nothing to cascade TO: these stores
 * share no key with each other or with anything, which is exactly what makes a
 * clean deletion possible.
 *
 * ## Counted before and after, and the two must reconcile
 *
 * A `DELETE` that reports a row count is trusting the driver's word for it. So
 * the window is counted first, deleted, and counted again — and the remaining
 * count must be zero. **An operation that can return nothing is asked what it
 * returned**, and a deletion is the one operation where "it seemed to work" is
 * least recoverable.
 */
import { and, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { createGuardedNeon } from "./guarded-neon.ts";

import { reactions, searchLog } from "./schema.ts";
import { WriteHandleRefused, resolveProductionWriteHandle } from "./write-handle.ts";

export interface DemoDeletionResult {
  /** `from` is `null` when the lower bound is THE BEGINNING — RULING 142. */
  window: { from: string | null; to: string };
  /** Rows removed, per store. Stated per store, never as one blended total. */
  deleted: Record<string, number>;
  /** What the window held before, so the two numbers can be reconciled. */
  counted: Record<string, number>;
}

/**
 * Delete every row in the two sold stores inside `[from, to]`.
 *
 * The bounds are inclusive DATES. A row is in the demo if it happened on or
 * between the day the wall went up and the day it came down.
 *
 * **`from` may be `null`, and that is a bound rather than a missing one** —
 * RULING 142. Nothing collected before the wall comes down is sellable, so
 * when `WALL_UP` was never established the correct lower bound is the
 * beginning, and the predicate simply drops its lower half. A caller that
 * meant *I do not know the start* must not pass `null` here; `demoSweepVerdict`
 * is what decides which of the two this is, and it says so in words.
 */
export async function deleteDemoWindowRows(
  from: string | null,
  to: string,
): Promise<DemoDeletionResult> {
  const handle = resolveProductionWriteHandle(process.env);
  if (!handle) {
    throw new WriteHandleRefused(
      "No production write handle. The demo deletion touches the live sold stores and " +
        "will not run against anything else.",
    );
  }

  const db = drizzle(createGuardedNeon(handle.connection));
  /*
   * STRINGS, because `occurred_at` is declared `mode: "string"`. Passing a
   * `Date` type-errors, and the reason is worth keeping: the column's mode is
   * what decides the comparison, so the bounds have to be written in the same
   * form the column stores.
   *
   * Inclusive of the whole FINAL DAY, not just its first instant — otherwise a
   * reaction recorded at noon on the day the wall came down would survive a
   * deletion that promised to take it.
   */
  const start = from === null ? null : `${from}T00:00:00.000Z`;
  const end = `${to}T23:59:59.999Z`;

  const counted: Record<string, number> = {};
  const deleted: Record<string, number> = {};

  for (const [name, table, column] of [
    ["reactions", reactions, reactions.occurredAt],
    ["search_log", searchLog, searchLog.occurredAt],
  ] as const) {
    const where = start === null ? lte(column, end) : and(gte(column, start), lte(column, end));

    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(where);
    counted[name] = before[0]?.n ?? 0;

    await db.delete(table).where(where);

    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(where);
    const remaining = after[0]?.n ?? 0;

    /*
     * The reconciliation. A driver reporting a delete count is reporting what
     * it believes; a re-count of the same window is the only thing that
     * answers whether the rows are gone.
     */
    if (remaining !== 0) {
      throw new Error(
        `${name}: ${remaining} row(s) still inside the demo window after the delete. ` +
          "The deletion did NOT complete and must not be reported as though it had.",
      );
    }
    deleted[name] = counted[name];
  }

  return { window: { from, to }, deleted, counted };
}
