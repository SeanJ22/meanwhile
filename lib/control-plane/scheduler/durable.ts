/**
 * **THE SCHEDULER'S STATE, WHERE IT SURVIVES THE PROCESS.**
 * (Session B resume, W3.B and W3.C, 2026-08-31. RULING 212, RULING 218.)
 *
 * ## What was wrong, stated plainly
 *
 * `FreshnessDebt` existed in `debt.ts` and in the shadow loop's signature, and
 * nowhere else. `runCycle` accepted `debts` as an input and the runner passed
 * `debts: []` on every invocation. So the retry logic was real, tested, and
 * unreachable: a route that failed on Monday was not retried on Tuesday by a
 * fresh process, because Tuesday's process started with an empty debt list and
 * had no way to learn otherwise. A self-retrying debt that no process can
 * inherit is a comment about retrying.
 *
 * The second half was recurrence. The runner created ONE WorkItem and ONE
 * RouteTask per standing obligation and reused them every cycle. That only
 * appeared to work because the executor never disposed of anything — a
 * disposed RouteTask is settled, `reclaim` refuses to reopen it, and it cannot
 * be the container for the next occurrence. Fixing the executor (W3.A) makes
 * the reuse fail immediately, which is why both halves are one module.
 *
 * ## The model
 *
 * ```
 *   StandingObligation      never completes. Comes due, is worked, comes due
 *                           again. Carries next_due_at, which is INDEXED.
 *        |
 *        +-- occurrence 1   its own WorkItem, RouteTask, Attempt, disposition
 *        +-- occurrence 2   a DIFFERENT WorkItem and RouteTask
 *        +-- ...
 * ```
 *
 * The occurrence is the thing that completes. The obligation is the thing that
 * recurs. Modelling them as one row is what forced the reuse, and modelling
 * the obligation as a WorkItem would make "complete" mean two different things
 * in one store — which is the reason `obligation.ts` says it is deliberately
 * not a WorkItem.
 *
 * **Identity is DERIVED, and that is what makes no-RouteTask-reuse structural
 * rather than a rule somebody must remember.** An occurrence's WorkItem id is
 * derived from the obligation id AND the sequence number, and a RouteTask id is
 * derived from its WorkItem id. Two occurrences cannot collide on a RouteTask
 * without colliding on a sequence number first, and the sequence number comes
 * from the durable obligation row.
 */

import { createRouteTask, type RouteTask } from "../route-task.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";
import { registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

import type { FreshnessDebt } from "./debt.ts";
import type { FreshnessObligation } from "./obligation.ts";

/** The project every freshness WorkItem is filed under. One string, one place. */
export const FRESHNESS_PROJECT = "freshness";

/**
 * A standing obligation as the control plane holds it.
 *
 * `nextDueAt` is STORED rather than only derived, and the Postgres provider
 * indexes it. Deriving it per cycle is correct and is what `scheduleAll` does;
 * storing it is what lets a due-time query ask the database for the work that
 * is due instead of loading every obligation and filtering in the process. At
 * 78 obligations the difference is nothing. The reason to build it now is that
 * the shape which does not scale is the shape that gets shipped.
 */
export interface StandingObligation extends FreshnessObligation {
  /** The derived next-due, as of the last cycle that scheduled it. */
  readonly nextDueAt: string | null;
  /** How many occurrences this obligation has opened. Monotonic. */
  readonly occurrenceCount: number;
  /** The occurrence currently open, if one is. */
  readonly openOccurrenceId: string | null;
  readonly updatedAt: string;
}

/**
 * ONE DUE OCCURRENCE of a standing obligation.
 *
 * This is the thing that has a lifecycle. It opens when the obligation comes
 * due, owns exactly one WorkItem and one RouteTask, and closes when that
 * RouteTask reaches a terminal disposition — or is abandoned, in which case it
 * closes unresolved and the obligation opens a NEW one next time rather than
 * reusing a settled task.
 */
export interface FreshnessOccurrence {
  readonly id: string;
  readonly obligationId: string;
  /** Monotonic per obligation, starting at 1. Part of the derived identity. */
  readonly sequence: number;
  /** The due time this occurrence answers. Not the time it opened. */
  readonly dueAt: string;
  readonly workItemId: string;
  readonly routeTaskId: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  /** The terminal disposition, when one was committed. Null otherwise. */
  readonly disposition: string | null;
  /** Why it closed without one. Null when it closed WITH one, or is open. */
  readonly unresolvedReason: string | null;
}

export function occurrenceId(obligationId: string, sequence: number): string {
  return `occ-${obligationId}-${String(sequence).padStart(6, "0")}`;
}

/**
 * The obligation clause of the occurrence's WorkItem, and the reason the
 * sequence number is in it.
 *
 * `workItemId` is a fingerprint over (project, subject, obligation). Putting
 * the sequence in the obligation clause is what makes occurrence 2's WorkItem
 * a different aggregate from occurrence 1's — and therefore what makes its
 * RouteTask a different aggregate, since a RouteTask id is derived from its
 * WorkItem id. Without it, every occurrence would derive the same two ids and
 * the reuse this module exists to end would come back silently.
 */
export function occurrenceObligationClause(obligationId: string, sequence: number): string {
  return `${obligationId}#${sequence}`;
}

/** Lift a plain obligation into a standing row. Never invents a next-due. */
export function standing(
  obligation: FreshnessObligation,
  now: string,
): StandingObligation {
  return {
    ...obligation,
    nextDueAt: null,
    occurrenceCount: 0,
    openOccurrenceId: null,
    updatedAt: now,
  };
}

/**
 * The fields a durable row owns because THIS PROCESS DID NOT PRODUCE THEM.
 *
 * Runtime state, every one: how many occurrences have opened, which is open,
 * when the obligation was last actually worked to a disposition, and the
 * next-due derived from that. A registration pass that re-put the corpus
 * version of these would silently reset the schedule on every start, which is
 * the same defect as having no durable state at all, wearing a store.
 */
const RUNTIME_OWNED = [
  "nextDueAt",
  "occurrenceCount",
  "openOccurrenceId",
  "lastWorkedAt",
] as const;

/**
 * Register what is new, and REFRESH THE SIGNALS on what is not.
 *
 * ## The defect this closes, found by hitting it
 * (Session C, PART D, 2026-08-31.)
 *
 * This function used to READ an existing row and return it untouched. That is
 * right for the four runtime fields above and wrong for everything else, and
 * the difference showed up the first time a provider CORRECTED a cadence
 * signal: the campaign-finance records were registered with `readerImpactAt`
 * set to the 2026 general election, that was diagnosed as a misreading of the
 * field — campaign-finance staleness costs a reader today, not in November —
 * and the corrected provider emitted `null`. **The correction could not reach
 * the durable rows.** They kept deriving a thirty-day cadence from a signal the
 * code no longer produces, and nothing anywhere reported a disagreement.
 *
 * A provider's signals are DERIVED FROM COMMITTED INPUTS on every pass, so the
 * corpus is authoritative for them and the store is authoritative for runtime
 * state. Splitting on that line is what makes a corrected derivation take
 * effect without resetting a clock.
 *
 * `refreshed` names every row whose signals actually moved, so a cycle that
 * silently re-cadenced 78 obligations is visible rather than inferred.
 */
export async function syncObligations(
  repos: ControlPlaneRepositories,
  corpus: readonly FreshnessObligation[],
  now: string,
): Promise<{
  readonly all: readonly StandingObligation[];
  readonly registered: readonly string[];
  readonly alreadyDurable: readonly string[];
  /** Durable rows whose provider-derived signals changed this pass. */
  readonly refreshed: readonly { readonly id: string; readonly changed: readonly string[] }[];
}> {
  const registered: string[] = [];
  const alreadyDurable: string[] = [];
  const refreshed: { id: string; changed: string[] }[] = [];
  const all: StandingObligation[] = [];

  /*
   * ONE READ OF THE WHOLE TABLE, not one read per obligation.
   * (Session C3, lane C, 2026-09-01.)
   *
   * This loop used to issue `repos.obligations.read(o.id)` per row, which is one
   * network round trip per obligation against the Postgres control plane. That
   * was invisible at 99 obligations and became the binding constraint the
   * moment RULING 229 was taken seriously: acquiring to the AUTHORITATIVE
   * SOURCE UNIVERSE means the corpus is thousands of rows, not dozens, and a
   * scheduler whose registration cost is linear in round trips would have made
   * "name every government" cost minutes per cycle.
   *
   * `list()` is on the same interface, is ordered by id, and both stores
   * implement it. The semantics below are unchanged — same CAS, same revisions,
   * same refusal to touch runtime-owned fields — because the only thing that
   * moved is WHERE the existing row is found.
   */
  const existingById = new Map<string, { id: string; revision: number; value: StandingObligation }>();
  for (const row of await repos.obligations.list()) {
    existingById.set(row.id, { id: row.id, revision: row.revision, value: row.value });
  }

  for (const o of corpus) {
    const existing = existingById.get(o.id) ?? null;
    if (existing === null) {
      const row = standing(o, now);
      await repos.obligations.put(o.id, row, now);
      registered.push(o.id);
      all.push(row);
      continue;
    }

    alreadyDurable.push(o.id);
    const held = existing.value;
    const next: StandingObligation = {
      ...o,
      nextDueAt: held.nextDueAt,
      occurrenceCount: held.occurrenceCount,
      openOccurrenceId: held.openOccurrenceId,
      lastWorkedAt: held.lastWorkedAt,
      updatedAt: now,
    };

    const changed: string[] = [];
    for (const key of Object.keys(o) as (keyof FreshnessObligation)[]) {
      if ((RUNTIME_OWNED as readonly string[]).includes(key)) continue;
      if (held[key] !== o[key]) changed.push(key);
    }

    if (changed.length === 0) {
      all.push(held);
      continue;
    }
    const written = await repos.obligations.compareAndSet(
      existing.id,
      existing.revision,
      next,
      now,
    );
    refreshed.push({ id: o.id, changed });
    all.push(written.value);
  }
  return { all, registered, alreadyDurable, refreshed };
}

/**
 * Open the next occurrence of a due obligation, with its own WorkItem and
 * RouteTask.
 *
 * Returns null when the obligation names no route — there is nothing to build a
 * RouteTask against, and inventing one would produce a task that can only ever
 * be disposed `NOT_APPLICABLE` for a reason that is about us.
 */
export async function openOccurrence(
  repos: ControlPlaneRepositories,
  input: {
    readonly obligation: StandingObligation;
    readonly dueAt: string;
    readonly now: string;
  },
): Promise<{
  readonly occurrence: FreshnessOccurrence;
  readonly workItem: WorkItem;
  readonly routeTask: RouteTask;
} | null> {
  const o = input.obligation;
  if (o.routeId === null) return null;

  const sequence = o.occurrenceCount + 1;
  const workItem = createWorkItem({
    project: FRESHNESS_PROJECT,
    subject: o.subjectId,
    obligation: occurrenceObligationClause(o.id, sequence),
    why:
      `occurrence ${sequence} of standing freshness obligation ${o.id} (${o.recordClass}), due ` +
      `${input.dueAt}. The obligation recurs; THIS is the piece of work that completes.`,
    now: input.now,
  });
  const routeTask = createRouteTask({
    workItemId: workItem.id,
    routeId: o.routeId,
    routeLabel: o.routeId,
    target: o.subjectId,
    inherited: true,
    now: input.now,
  });

  await registerWorkItem(repos, workItem, input.now);
  await registerRouteTask(repos, routeTask, input.now);

  const occurrence: FreshnessOccurrence = {
    id: occurrenceId(o.id, sequence),
    obligationId: o.id,
    sequence,
    dueAt: input.dueAt,
    workItemId: workItem.id,
    routeTaskId: routeTask.id,
    openedAt: input.now,
    closedAt: null,
    disposition: null,
    unresolvedReason: null,
  };
  await repos.occurrences.put(occurrence.id, occurrence, input.now);

  const row = await repos.obligations.mustRead(o.id);
  await repos.obligations.compareAndSet(
    o.id,
    row.revision,
    {
      ...row.value,
      occurrenceCount: sequence,
      openOccurrenceId: occurrence.id,
      updatedAt: input.now,
    },
    input.now,
  );

  return { occurrence, workItem, routeTask };
}

/**
 * Close an occurrence.
 *
 * `disposition` non-null means the route reached a terminal conclusion and the
 * obligation was DISCHARGED — `lastWorkedAt` moves and the next-due recomputes
 * from it. `disposition` null means it did not, and `lastWorkedAt` does NOT
 * move: an occurrence that was abandoned is not work, and advancing the anchor
 * on it would push the next check further out for having failed, which is the
 * one direction a freshness clock must never drift.
 */
export async function closeOccurrence(
  repos: ControlPlaneRepositories,
  input: {
    readonly occurrenceId: string;
    readonly disposition: string | null;
    readonly unresolvedReason: string | null;
    readonly now: string;
  },
): Promise<FreshnessOccurrence> {
  const row = await repos.occurrences.mustRead(input.occurrenceId);
  if (row.value.closedAt !== null) return row.value;

  const closed: FreshnessOccurrence = {
    ...row.value,
    closedAt: input.now,
    disposition: input.disposition,
    unresolvedReason: input.unresolvedReason,
  };
  await repos.occurrences.compareAndSet(row.id, row.revision, closed, input.now);

  const obligationRow = await repos.obligations.mustRead(row.value.obligationId);
  await repos.obligations.compareAndSet(
    obligationRow.id,
    obligationRow.revision,
    {
      ...obligationRow.value,
      openOccurrenceId: null,
      ...(input.disposition !== null ? { lastWorkedAt: input.now } : {}),
      updatedAt: input.now,
    },
    input.now,
  );
  return closed;
}

/** Record the derived next-due against the durable row, so a query can use it. */
export async function recordNextDue(
  repos: ControlPlaneRepositories,
  input: { readonly obligationId: string; readonly nextDueAt: string; readonly now: string },
): Promise<void> {
  const row = await repos.obligations.mustRead(input.obligationId);
  if (row.value.nextDueAt === input.nextDueAt) return;
  await repos.obligations.compareAndSet(
    row.id,
    row.revision,
    { ...row.value, nextDueAt: input.nextDueAt, updatedAt: input.now },
    input.now,
  );
}

/** ------------------------------------------------------------------ debt */

/**
 * Every debt row this control plane holds.
 *
 * THE ENTRY POINT FOR THE SEEDED FAILURE: a debt created in process 1 is
 * loaded by process 2 through this function, with no shared memory between
 * them. If this returns an empty list where process 1 wrote a row, the debt was
 * never durable and the retry logic above it is decoration.
 */
export async function loadDebts(
  repos: ControlPlaneRepositories,
): Promise<readonly FreshnessDebt[]> {
  const rows = await repos.debts.list();
  return rows.map((r) => r.value);
}

/**
 * Persist this cycle's debt set: write what is owed, clear what is discharged.
 *
 * The clearing half is as important as the writing half and is easier to get
 * wrong. A cycle that only ever wrote debt would accumulate rows for
 * obligations that have since succeeded, and the incident aggregate would
 * report an outage that ended days ago.
 */
export async function persistDebts(
  repos: ControlPlaneRepositories,
  next: readonly FreshnessDebt[],
  now: string,
): Promise<{ readonly written: number; readonly cleared: readonly string[] }> {
  const byId = new Map(next.map((d) => [d.obligationId, d]));
  const existing = await repos.debts.list();
  const cleared: string[] = [];

  for (const row of existing) {
    if (byId.has(row.value.obligationId)) continue;
    /*
     * A cleared debt is written as a TOMBSTONE rather than deleted, because
     * `AggregateRepository` has no delete and should not grow one: an
     * append-shaped store whose rows can vanish cannot be replayed, and the
     * history of what was behind and recovered is exactly what an operator
     * asks for after an outage. `loadDebts` above returns the tombstone too;
     * `retryable` ignores it because a zero-failure row has no retry due.
     */
    if (row.value.consecutiveFailures === 0) continue;
    await repos.debts.compareAndSet(
      row.id,
      row.revision,
      { ...row.value, consecutiveFailures: 0, detail: `cleared at ${now}: the obligation was discharged` },
      now,
    );
    cleared.push(row.value.obligationId);
  }

  let written = 0;
  for (const debt of next) {
    const row = await repos.debts.read(debt.obligationId);
    if (row === null) {
      await repos.debts.put(debt.obligationId, debt, now);
    } else {
      await repos.debts.compareAndSet(row.id, row.revision, debt, now);
    }
    written += 1;
  }
  return { written, cleared };
}

/**
 * The obligations whose stored next-due has passed.
 *
 * The provider-neutral form is a filter over `list()`; the Postgres provider
 * has an index on `next_due_at` that makes the same question a range scan. Both
 * answer identically, which is the property the conformance suite checks.
 */
export async function dueByStoredTime(
  repos: ControlPlaneRepositories,
  nowIso: string,
): Promise<readonly StandingObligation[]> {
  const rows = await repos.obligations.list();
  return rows
    .map((r) => r.value)
    .filter((o) => o.active && o.nextDueAt !== null && o.nextDueAt <= nowIso)
    .sort((a, b) => ((a.nextDueAt ?? "") < (b.nextDueAt ?? "") ? -1 : 1));
}
