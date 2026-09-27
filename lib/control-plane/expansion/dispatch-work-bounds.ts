/**
 * **MW-028'S TWO BOUNDS, IN ONE PURE PLACE.** (2026-09-23.)
 *
 * The runner enforces them (`dispatch-work.ts`), and the gateway receipt, the
 * deploy preview and the Send screen quote them. One constant each, so what the
 * owner reads before sending is the number the runner holds to.
 *
 * PURE. No import, so a client component may read it.
 */

/**
 * Obligations the runner creates per cycle, every target together. Each costs
 * one store round trip when it is written and one next-due write when it is
 * first scheduled; 200 keeps a cycle's creation well under a minute of its
 * fifteen. The rest is deferred to the next cycles and counted.
 */
export const DISPATCH_WORK_WRITE_BUDGET = 200;

/** Missing obligations considered per geography in one cycle. The remainder advances automatically in later cycles. */
export const DISPATCH_WORK_TARGET_CAP = 1_000;
