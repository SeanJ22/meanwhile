/**
 * **THE SHADOW LOOP — one unattended cycle, end to end.**
 * (Session B, W3.5, 2026-08-30.)
 *
 * ```
 *   RECLAIM   sweep leases whose holder stopped renewing
 *   SCHEDULE  derive a next-due for every active obligation
 *   RETRY     take back the debt whose backoff has elapsed
 *   DISPATCH  claim what is due and run it through a disposable worker
 *   RECORD    results, debt, next-due — durably, through the repositories
 *   DIGEST    a reading whose headline is PILOT HEALTH
 * ```
 *
 * ## Shadow means one thing, precisely
 *
 * The loop OBSERVES, ACQUIRES, RECORDS and runs the canonical instruments.
 * **It does not promote anything to canonical reader truth.** No result of a
 * cycle changes what a reader is told. That is not a safety margin around a
 * feature that is nearly ready — it is the state RULING 212, 216 and 218
 * jointly require until the scheduler's results are INDEPENDENTLY_REPRODUCED,
 * and the session that built the scheduler cannot supply that by definition.
 *
 * `promoteToReaderTruth` does not exist in this module and no caller can pass
 * a flag that would create it. The absence is the mechanism.
 *
 * ## Why the digest leads with PILOT HEALTH and not with activity
 *
 * RULING 217. A digest that leads with *312 routes walked, 1,847 records
 * refreshed* reads as health and measures effort — and effort is not evidence.
 * The three contracts come first, each stating its own blocker, and the
 * activity counts sit underneath where they belong: as what the loop did, not
 * as how the pilot is.
 */

import {
  aggregateIncidents,
  recordFailure,
  retryable,
  stalenessRisk,
  type FreshnessDebt,
  type Incident,
  type StalenessRisk,
} from "./debt.ts";
import {
  dischargesObligation,
  dispatchOne,
  sweepExpiredLeases,
  type DispatchResult,
  type MethodMaturity,
  type ReclaimSweep,
  type DeclaredExecutor,
  type WorkerBound,
} from "./dispatch.ts";
import {
  dueNow,
  scheduleAll,
  type FreshnessObligation,
  type ScheduledObligation,
  type SchedulePass,
} from "./obligation.ts";
import type { ContractReading, PilotHealthRollup } from "../../health/contracts.ts";
import { freshnessContract, pilotHealth } from "../../health/contracts.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

/** One cycle's inputs. Every clock and every seam is injected. */
export interface CycleInput {
  readonly repos: ControlPlaneRepositories;
  readonly obligations: readonly FreshnessObligation[];
  /** Debt carried in from the previous cycle. Durable state, passed through. */
  readonly debts: readonly FreshnessDebt[];
  /** Obligation id → the RouteTask that works it, where one is registered. */
  readonly routeTaskFor: (obligationId: string) => string | null;
  readonly maturity: MethodMaturity;
  /**
    * The executor, WITH its lane declared. (W3.E regression, 2026-08-31.)
    *
    * A bare `run` let the dispatcher open the persisted Attempt under the
    * lane the method store IMPLIED rather than the one about to execute, so a
    * deterministic walk was recorded as an anthropic model worker.
    */
  /**
   * **A FUNCTION IS ACCEPTED, AND THAT IS PART D1's REQUIREMENT.**
   * (Session C, 2026-08-31.)
   *
   * One `DeclaredExecutor` for a whole cycle was right while every obligation
   * came from one corpus and was worked by one HTTP GET. It cannot express the
   * registry: a campaign-finance portfolio carries a DataTables POST that is
   * deterministic, an FTP drop no client here can open, and a records-request
   * route that ends in a human act. Those are different lanes over one cycle,
   * and the lane is DECLARED before the Attempt is persisted — so it has to be
   * decidable per obligation or the Attempt is opened under the wrong worker
   * identity, which is the exact W3.E defect wearing a registry.
   */
  readonly executor: DeclaredExecutor | ((obligation: ScheduledObligation) => DeclaredExecutor);
  readonly methodVersion?: number;
  readonly policyVersion?: string;
  readonly holder: string;
  readonly now: string;
  readonly leaseTtlMs: number;
  readonly bound?: WorkerBound;
  /**
   * The canonical READER and TRUTH readings, taken by their own instruments.
   * Passed in rather than computed here: a scheduler that computed its own
   * reader health would be grading its own homework, and the digest's headline
   * has to come from the instruments that own those contracts.
   */
  readonly reader: ContractReading;
  readonly truth: ContractReading;
  /** A ceiling on how many due items one cycle dispatches. Stated, not implied. */
  readonly maxDispatches?: number;
  /**
   * **A WALL-CLOCK BUDGET FOR DISPATCH, SO THE CYCLE FINISHES CLEANLY.**
   * (Autonomy-recovery session, 2026-09-01.)
   *
   * The runner supervises each cycle under a hard ceiling and kills a child
   * that outlives it. A kill lands mid-dispatch: occurrences opened and not
   * closed, an Attempt with no outcome, a lease that expires unrenewed — and
   * the next cycle resumes that state and pays for it again. A cycle over the
   * real backlog can outlive the ceiling on latency alone, so the overrun is a
   * recovery seam and not an edge case.
   *
   * With a budget the cycle stops STARTING work once the injected clock passes
   * `deadlineMs`: every remaining due item is DEFERRED with a named reason, the
   * record is written, and the process exits clean inside the supervisor's
   * ceiling. Nothing is lost — a deferred item keeps its next-due and is
   * dispatched by a later cycle. Injected, never `Date.now()` here, so a test
   * can move the clock.
   */
  readonly budget?: { readonly deadlineMs: number; readonly now: () => number };
}

export interface CycleResult {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly reclaim: ReclaimSweep;
  readonly schedule: SchedulePass;
  readonly dueCount: number;
  readonly dispatched: readonly DispatchResult[];
  /** Due work this cycle did NOT reach, and the reason. Never silent. */
  readonly deferred: readonly { readonly obligationId: string; readonly why: string }[];
  /** Obligations DISCHARGED this cycle — a committed disposition, each one. */
  readonly worked: readonly string[];
  /** Obligations whose executor deliberately did nothing. Still owed. */
  readonly simulated: readonly string[];
  readonly debts: readonly FreshnessDebt[];
  readonly incidents: readonly Incident[];
  readonly risk: StalenessRisk;
  readonly health: PilotHealthRollup;
  /** Structural, and it is the shadow guarantee. Always false in this module. */
  readonly promotedToReaderTruth: false;
}

/**
 * Run one full cycle. Unattended: nothing here can ask a question.
 *
 * A cycle that could block on an answer is a cycle that stops the loop, and
 * RULING 146 forbids it — a decision that is genuinely the author's becomes a
 * Needs Sean row and the session keeps going. There is no prompt, no readline
 * and no confirmation in this path.
 */
export async function runCycle(input: CycleInput): Promise<CycleResult> {
  const startedAt = input.now;
  const nowMs = Date.parse(input.now);

  /*
   * 1 · RECLAIM FIRST, and the order matters. A route still leased by a dead
   * worker is a route this cycle would skip as contended. Sweeping before
   * scheduling means a worker that died since the last cycle costs one cycle
   * of latency rather than a lease TTL every cycle forever.
   */
  const reclaim = await sweepExpiredLeases(input.repos, {
    now: input.now,
    observedBy: input.holder,
  });

  /* 2 · SCHEDULE. Both lists; the unscheduled are named, never defaulted. */
  const schedule = scheduleAll(input.obligations, nowMs);

  /* 3 · RETRY. Debt whose backoff has elapsed rejoins the due set. */
  const retryIds = new Set(retryable(input.debts, nowMs).map((d) => d.obligationId));

  /*
   * **DEBT BACKOFF GATES RE-DISPATCH, and without this it does not.**
   * (Session C, 2026-08-31.)
   *
   * `dueNow` answers "has the clock passed?" and knows nothing about failure.
   * An obligation that has never been discharged never advances its anchor, so
   * its next-due sits permanently in the past and it was dispatched on EVERY
   * cycle regardless of the backoff `recordFailure` computed. The retry
   * schedule was therefore real, tested, and bypassed — the same shape as the
   * debt that was durable in a store nothing loaded.
   *
   * It only became visible when a permanently-walled route was registered: the
   * Arizona FTP drop this process holds no client for would have been opened,
   * refused and re-opened once a cycle forever, and the incident aggregate
   * would have reported an outage that is really a missing adapter.
   *
   * So an obligation carrying debt is due only when its backoff has ELAPSED.
   * It is held out by name and counted in `deferred`, never dropped.
   */
  const backedOff = new Map(
    input.debts
      .filter((d) => d.consecutiveFailures > 0 && !retryIds.has(d.obligationId))
      .map((d) => [d.obligationId, d]),
  );

  const due = dueNow(schedule, nowMs).filter((row) => !backedOff.has(row.obligation.id));
  const alsoDue = schedule.scheduled.filter(
    (row) => retryIds.has(row.obligation.id) && !due.includes(row),
  );
  const workNow = [...due, ...alsoDue];

  /* 4 · DISPATCH, under a stated ceiling. Anything beyond it is DEFERRED with
        a reason rather than dropped — a queue that silently truncates reports
        the same number whatever the backlog is. */
  const ceiling = input.maxDispatches ?? workNow.length;
  const dispatched: DispatchResult[] = [];
  const worked: string[] = [];
  const simulated: string[] = [];
  const deferred: { obligationId: string; why: string }[] = [];
  for (const [obligationId, debt] of backedOff) {
    deferred.push({
      obligationId,
      why:
        `its clock has passed and it is holding ${debt.consecutiveFailures} consecutive failure(s), ` +
        `so the backoff computed for it stands until ${debt.retryAt}. Held out of this cycle ` +
        "and counted here — a walled route re-opened every cycle is a hot loop reported as an outage.",
    });
  }
  const debtsById = new Map(input.debts.map((d) => [d.obligationId, d]));

  for (const [i, row] of workNow.entries()) {
    if (input.budget !== undefined && input.budget.now() >= input.budget.deadlineMs) {
      deferred.push({
        obligationId: row.obligation.id,
        why:
          `the cycle's dispatch budget was spent at ${new Date(input.budget.deadlineMs).toISOString()} ` +
          "before this item was reached. It keeps its next-due and is dispatched by a later cycle — " +
          "a cycle that ends on its own budget leaves recoverable state; one killed mid-write by its " +
          "supervisor does not",
      });
      continue;
    }
    if (i >= ceiling) {
      deferred.push({
        obligationId: row.obligation.id,
        why:
          `this cycle dispatched its stated ceiling of ${ceiling} item(s) and ${workNow.length - ceiling} ` +
          "remained due. They are deferred to the next cycle, counted here, and their debt " +
          "continues to age — a ceiling that dropped them silently would report the same number " +
          "whatever the backlog was",
      });
      continue;
    }
    /*
     * **ONE OBLIGATION'S THROW MAY NOT ABORT THE CYCLE.** (Autonomy-recovery
     * session, 2026-09-01.)
     *
     * `dispatchOne` already converts every EXPECTED failure — a live foreign
     * lease, a refused disposition, a worker that threw — into a FAILED
     * `DispatchResult` and returns it. What it does not catch is an UNEXPECTED
     * throw from the store beneath it: a transient Neon error, or the
     * inconsistent state a killed cycle leaves behind (an occurrence whose
     * RouteTask a crash left mid-transition). Before this, such a throw
     * propagated out of `runCycle`, aborted the whole cycle, and stranded every
     * other due occurrence — and a crash-restart re-hit the same state and
     * re-aborted, which is the recovery loop that required manual surgery.
     *
     * So an unexpected throw is isolated to its obligation: recorded as a
     * FAILED dispatch (the branch below accrues debt and keeps it owed) and the
     * cycle continues. The obligation is not discharged, only deferred to a
     * retry — which is exactly the honest state.
     */
    let result: DispatchResult;
    try {
      result = await dispatchOne(input.repos, {
        obligation: row,
        routeTaskId: input.routeTaskFor(row.obligation.id),
        holder: input.holder,
        now: input.now,
        leaseTtlMs: input.leaseTtlMs,
        bound: input.bound,
        maturity: input.maturity,
        executor: typeof input.executor === "function" ? input.executor(row) : input.executor,
        ...(input.methodVersion !== undefined ? { methodVersion: input.methodVersion } : {}),
        ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
      });
    } catch (error) {
      result = {
        obligationId: row.obligation.id,
        routeTaskId: input.routeTaskFor(row.obligation.id),
        executor: null,
        executorChosen: null,
        executorMismatch: false,
        claimed: false,
        outcome: "FAILED",
        attemptId: null,
        dispositionCommitted: false,
        disposition: null,
        artifactIds: [],
        cost: null,
        worker: null,
        detail:
          "the dispatch threw and was isolated so the cycle could continue rather than aborting " +
          `every other due occurrence: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    dispatched.push(result);

    /*
     * 5 · RECORD. A failure becomes DEBT — durable, self-retrying, and nobody
     * is notified (RULING 218).
     *
     * **DEBT IS CLEARED BY A COMMITTED DISPOSITION AND BY NOTHING ELSE.**
     * (Session B resume, W3.A.) This read `result.outcome === "WORKED"`, and
     * WORKED was issued on a seam that returned `ok: true` for a no-op. So a
     * shadow executor that fetched nothing deleted the obligation's debt and
     * the loop recomputed a next-due from work that never happened —
     * freshness, asserted from our own inaction. `dischargesObligation`
     * requires the disposition commit, and it is the ONLY thing that does.
     */
    if (dischargesObligation(result)) {
      debtsById.delete(row.obligation.id);
      worked.push(row.obligation.id);
    } else if (result.outcome === "SIMULATED") {
      /*
       * A SHADOW DECISION IS NOT A FAILURE AND IT IS NOT A SUCCESS.
       *
       * It does not become debt, because nothing about the publisher went
       * wrong and an incident count that rose on our own decision not to walk
       * would report a wall where there is none. It does not clear debt
       * either. Any debt the obligation already carried stands untouched, and
       * the obligation stays due — which is the honest state: still owed.
       */
      simulated.push(row.obligation.id);
    } else if (result.outcome !== "NOT_CLAIMED") {
      /*
       * FAILED, NO_ROUTE_TASK, and — the case that is easy to miss — a WORKED
       * result whose committed disposition is NOT a reading. A route disposed
       * `BLOCKED_CURRENTLY` reached a legitimate terminal state and refreshed
       * nothing, so the obligation is still owed and its debt still accrues.
       * Letting that fall through to neither branch would leave a walled route
       * with no debt row, which is an obligation that quietly stops retrying.
       */
      debtsById.set(
        row.obligation.id,
        recordFailure(debtsById.get(row.obligation.id) ?? null, {
          obligationId: row.obligation.id,
          cause:
            result.outcome === "NO_ROUTE_TASK"
              ? "NEVER_DISPATCHED"
              : result.dispositionCommitted
                ? "REFUSED_BY_HOST"
                : "UPSTREAM_ERROR",
          detail: result.dispositionCommitted
            ? `the route was disposed ${result.disposition}, which closes the RouteTask and is ` +
              `not a reading of the record: ${result.detail}`
            : result.detail,
          target: row.obligation.routeId ?? row.obligation.subjectId,
          dueAt: row.nextDueAt,
          now: input.now,
        }),
      );
    }
    /* NOT_CLAIMED is not a failure. Another worker holds it; that is the lease
       working, and counting it as debt would make ordinary concurrency read as
       a backlog. */
  }

  const debts = [...debtsById.values()];
  const risk = stalenessRisk({
    scheduled: schedule.scheduled.length,
    unscheduled: schedule.unscheduled.length,
    overdue: workNow.length - worked.length,
    debts,
    nowMs,
  });

  return {
    startedAt,
    finishedAt: new Date(nowMs).toISOString(),
    reclaim,
    schedule,
    dueCount: workNow.length,
    dispatched,
    worked,
    simulated,
    deferred,
    debts,
    incidents: aggregateIncidents(debts, nowMs),
    risk,
    health: pilotHealth(input.reader, input.truth, freshnessContract(risk)),
    promotedToReaderTruth: false,
  };
}

/**
 * The digest, in the order RULING 217 requires: health first, activity under.
 *
 * Returned as lines rather than printed, so the same function serves a console
 * run, a run record and a test — three surfaces that must not be able to
 * disagree about what the cycle said.
 */
export function digestLines(cycle: CycleResult): string[] {
  const out: string[] = [];
  out.push("PILOT HEALTH");
  for (const r of cycle.health.readings) {
    out.push(`  ${r.contract.padEnd(9)} ${r.state}`);
    out.push(`      ${r.reason}`);
  }
  out.push(
    `  ROLLUP    ${cycle.health.green ? "GREEN" : "NOT GREEN"}` +
      (cycle.health.blocking.length > 0
        ? ` — blocked by ${cycle.health.blocking.map((b) => `${b.contract} (${b.state})`).join(", ")}`
        : ""),
  );
  out.push("");
  out.push("ACTIVITY — what this cycle did, which is not how the pilot is");
  out.push(
    `  obligations        ${cycle.schedule.scheduled.length} scheduled · ` +
      `${cycle.schedule.unscheduled.length} unscheduled`,
  );
  for (const u of cycle.schedule.unscheduled) {
    out.push(`      UNSCHEDULED ${u.obligation.id}: ${u.reason}`);
  }
  out.push(`  due this cycle     ${cycle.dueCount}`);
  out.push(
    `  dispatched         ${cycle.dispatched.length} — ` +
      `${cycle.worked.length} DISCHARGED, ` +
      `${cycle.simulated.length} simulated (no retrieval), ` +
      `${cycle.dispatched.filter((d) => d.outcome === "FAILED").length} failed, ` +
      `${cycle.dispatched.filter((d) => d.outcome === "NOT_CLAIMED").length} held by another worker, ` +
      `${cycle.dispatched.filter((d) => d.outcome === "NO_ROUTE_TASK").length} with no route task`,
  );
  /*
   * DISCHARGED is counted from the disposition commits, never from the WORKED
   * label, and the line below states the artifact and disposition evidence
   * beside it so the two cannot drift apart in a report.
   */
  const committed = cycle.dispatched.filter((d) => d.dispositionCommitted);
  out.push(
    `  dispositions       ${committed.length} committed — ` +
      (committed.length === 0
        ? "none, so nothing this cycle discharged an obligation"
        : committed.map((d) => `${d.disposition}`).join(", ")),
  );
  out.push(
    `  artifacts          ${committed.reduce((n, d) => n + d.artifactIds.length, 0)} recorded ` +
      "against a closed Attempt",
  );
  if (cycle.simulated.length > 0) {
    out.push(
      `      SIMULATED ${cycle.simulated.length} obligation(s) had a shadow decision and NO ` +
        "retrieval. They are still owed, their debt stands, and none of them is discharged.",
    );
  }
  const byExecutor = (kind: string): number =>
    cycle.dispatched.filter((d) => d.executor === kind).length;
  out.push(
    `  executors          ${byExecutor("DETERMINISTIC")} deterministic · ` +
      `${byExecutor("BOUNDED_MODEL_WORKER")} bounded model worker`,
  );
  out.push(`  deferred           ${cycle.deferred.length}`);
  const withCost = cycle.dispatched.filter((d) => d.cost !== null);
  const usd = withCost.reduce((n, d) => n + (d.cost?.usd ?? 0), 0);
  out.push(
    `  cost               ${usd.toFixed(4)} over ${withCost.length} measured Attempt(s) of ` +
      `${cycle.dispatched.length} dispatched`,
  );
  for (const kind of ["DETERMINISTIC", "BOUNDED_MODEL_WORKER"] as const) {
    const rows = cycle.dispatched.filter((d) => d.executor === kind);
    const spent = rows.reduce((n, d) => n + (d.cost?.usd ?? 0), 0);
    out.push(
      `      ${kind.padEnd(21)} ${rows.length} Attempt(s), ${spent.toFixed(4)}` +
        (rows.length === 0 ? "" : ` — models: ${
          [...new Set(rows.map((d) => d.worker?.version ?? "unrecorded"))].join(", ")
        }`),
    );
  }
  out.push(
    `  leases             ${cycle.reclaim.reclaimed.length} reclaimed · ` +
      `${cycle.reclaim.stillLive.length} still live · ${cycle.reclaim.refused.length} refused`,
  );
  out.push(`  freshness debt     ${cycle.debts.length} row(s) across ${cycle.incidents.length} incident(s)`);
  for (const i of cycle.incidents) {
    out.push(
      `      ${i.cause} at ${i.target}: ${i.obligationsAffected} obligation(s), oldest ` +
        `${i.oldestHours.toFixed(1)}h, next retry ${i.nextRetryAt}`,
    );
  }
  out.push("");
  out.push(
    `  PROMOTION          none. promotedToReaderTruth=${cycle.promotedToReaderTruth}. This loop ` +
      "observes, acquires and records; nothing it produced changed what a reader is told.",
  );
  return out;
}
