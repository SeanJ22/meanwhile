/**
 * **THE RESEARCH CYCLE'S FINALIZATION COMPLETES OR FAILS BY NAME, INSIDE THE
 * WALL.** (Runner bounded store calls, 2026-09-23.)
 *
 * After the last phase the cycle writes its research state, reads its code
 * identity, beats the heartbeat, appends its canonical outcome to the owner
 * digest log and writes its local record. On 2026-09-23 at 17:32:59Z a cycle
 * finished every phase by 17:43:10, wrote its research state at 17:43:29, and
 * then produced nothing until the supervisor's SIGTERM at 17:47:59: no
 * heartbeat, no digest, no local record, nothing on stderr. Across the 24
 * cycles on the runtime host that DID finish on 2026-09-22 and 2026-09-23, the
 * same stretch (final research-state beat to local record) took 6.4-14.2 s,
 * and twice 35 s.
 *
 * So every step gets its own budget, and every step is capped so the
 * canonical outcome and the local record still have their time before the
 * wall:
 *
 * ```
 *   step                   budget   what it covers
 *   research-state:final   45 s     a DOCUMENT read and compare-and-set (1.1 MB each way), and a retry
 *   code-identity          30 s     the bounded git fetch (20 s) and the first-parent walk
 *   heartbeat              25 s     a POINT read and compare-and-set
 *   digest:append          45 s     DOCUMENT probe, POINT allocate, DOCUMENT insert; retried while time remains
 *   local-record:write     -        a file write
 *   window-lease:release   20 s     a POINT read and compare-and-set; its TTL covers a miss
 * ```
 *
 * The run's SHA and provenance, which spawned git without a bound here, are
 * read once when the cycle starts: they describe the code and tree it started
 * from.
 *
 * Every record settles by 15 s before the wall. The steps before the digest
 * leave it its 45 s and the local record 5 s; a step that would eat into that
 * is cut short and fails by name. A failed digest append is the cycle's crash:
 * the crash handler appends a FAILED outcome inside its own 30 s budget and
 * writes the local crash record.
 */
import { withStoreBudget } from "../repository/request-bounds.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { appendFreshnessCycleDigest } from "../freshness-cycle-outcome.ts";
import type { FreshnessCycleOutcome } from "../owner-surface.ts";
import { describePending } from "./cycle-stall.ts";
import type { PendingSnapshot } from "./cycle-stall-report.ts";

export const CYCLE_FINALIZATION_BUDGETS_MS = Object.freeze({
  researchState: 45_000,
  codeIdentity: 30_000,
  heartbeat: 25_000,
  digestAppend: 45_000,
  windowLease: 20_000,
  crashDigest: 30_000,
});

/** Every finalization record settles by this long before the wall. */
export const RECORDS_MARGIN_BEFORE_WALL_MS = 15_000;
/** The local record's own reserve, after the digest. */
export const LOCAL_RECORD_RESERVE_MS = 5_000;
/** What the steps before the digest leave for it and the local record. */
export const DIGEST_AND_RECORD_RESERVE_MS = CYCLE_FINALIZATION_BUDGETS_MS.digestAppend + LOCAL_RECORD_RESERVE_MS;

export interface CycleClock {
  readonly processStartedMs: number;
  /** When the supervisor ends the child: process start plus the wall. */
  readonly wallAtMs: number;
  /** When the stall diagnostic fires, and optional late work yields. */
  readonly stallAtMs: number;
  /** Every finalization record settles by here. */
  readonly recordsDeadlineMs: number;
}

export function cycleClock(input: { readonly processStartedMs: number; readonly wallMs: number; readonly stallLeadMs: number }): CycleClock {
  const wallAtMs = input.processStartedMs + Math.max(0, input.wallMs);
  return {
    processStartedMs: input.processStartedMs,
    wallAtMs,
    stallAtMs: Math.max(input.processStartedMs, wallAtMs - input.stallLeadMs),
    recordsDeadlineMs: Math.max(input.processStartedMs, wallAtMs - RECORDS_MARGIN_BEFORE_WALL_MS),
  };
}

/**
 * A step's budget: its own, cut to what is left before `deadlineMs` once the
 * later steps' reserve is set aside. Zero means there is no time for it.
 */
export function stepBudgetMs(input: {
  readonly nowMs: number;
  readonly budgetMs: number;
  readonly deadlineMs: number;
  readonly reservedAfterMs: number;
}): number {
  return Math.max(0, Math.floor(Math.min(input.budgetMs, input.deadlineMs - input.reservedAfterMs - input.nowMs)));
}

/** A finalization step that did not finish inside its budget. */
export class CycleStepTimeout extends Error {
  readonly code = "CYCLE_STEP_TIMEOUT";
  readonly step: string;
  readonly budgetMs: number;

  constructor(step: string, budgetMs: number) {
    super(
      budgetMs <= 0
        ? `CYCLE_STEP_TIMEOUT: ${step} was not started; no time was left for it before the wall`
        : `CYCLE_STEP_TIMEOUT: ${step} did not finish within its ${budgetMs} ms budget`,
    );
    this.name = "CycleStepTimeout";
    this.step = step;
    this.budgetMs = budgetMs;
  }
}

/**
 * The step's own backstop fires this long after its store budget, so a store
 * call in flight at the deadline is cut first and named for itself.
 */
export const STEP_BACKSTOP_GRACE_MS = 250;

/**
 * Run one step inside its budget. Store calls made inside it are bounded by the
 * budget (withStoreBudget), so they are cancelled at the deadline; any other
 * await is raced against it. It resolves with the step's value or rejects by
 * name: the step's own error, a ControlPlaneRequestTimeout, or a CycleStepTimeout.
 */
export async function runBoundedStep<T>(input: {
  readonly label: string;
  readonly budgetMs: number;
  readonly fn: () => Promise<T>;
}): Promise<T> {
  if (input.budgetMs <= 0) throw new CycleStepTimeout(input.label, 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new CycleStepTimeout(input.label, input.budgetMs)),
      input.budgetMs + STEP_BACKSTOP_GRACE_MS,
    );
  });
  try {
    return await Promise.race([withStoreBudget(input.label, input.budgetMs, input.fn), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------ the failed cycle --- */

export interface FailedCycleInput {
  readonly repos: ControlPlaneRepositories | null;
  readonly error: unknown;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  /** What the cycle was waiting on when it failed, from the main thread's own account. */
  readonly pending: PendingSnapshot | null;
  /** The canonical append's budget; zero records locally only, and says so. */
  readonly digestBudgetMs: number;
  /**
   * Write the local record and return its path. The writer owns the record
   * path, and carries forward the stall diagnostic's block if it fired first.
   */
  readonly writeLocalRecord: (record: Record<string, unknown>) => string;
  /** One stderr line. */
  readonly log: (line: string) => void;
}

export interface FailedCycleRecord {
  readonly canonical: "APPENDED" | "NOT_APPENDED" | "NO_TIME" | "NO_STORE";
  readonly recordPath: string | null;
  readonly lines: readonly string[];
}

/**
 * Record a cycle that crashed or timed out: the FAILED outcome in the canonical
 * owner digest log inside `digestBudgetMs`, then the local crash record,
 * whatever the append did. Never throws.
 */
export async function recordFailedCycle(input: FailedCycleInput): Promise<FailedCycleRecord> {
  const message = input.error instanceof Error ? (input.error.stack ?? input.error.message) : String(input.error);
  const headline = message.split("\n")[0] ?? "the cycle failed";
  const pendingLine = input.pending === null ? null : describePending(input.pending);
  const lines = [
    "PILOT HEALTH",
    "  the cycle CRASHED before completing — a failed cycle, never an idle one",
    `      ${headline}`,
    ...(pendingLine === null ? [] : [`      ${pendingLine}`]),
    "  ROLLUP    NOT GREEN — the cycle did not finish",
  ];

  let canonical: FailedCycleRecord["canonical"] = "NO_STORE";
  if (input.repos !== null) {
    if (input.digestBudgetMs <= 0) {
      canonical = "NO_TIME";
      input.log("freshness:shadow · no time was left before the wall for the canonical FAILED outcome; the local crash record carries it");
    } else {
      const repos = input.repos;
      const outcome: FreshnessCycleOutcome = {
        kind: "FRESHNESS_CYCLE",
        state: "FAILED",
        cycleId: input.cycleId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        testedSha: input.testedSha,
        host: input.host,
        provider: repos.describe(),
        durable: repos.durable,
        executor: null,
        registry: null,
        obligations: null,
        occurrencesOpened: null,
        debtInherited: null,
        debtPersisted: null,
        debtCleared: null,
        scheduled: null,
        unscheduled: [],
        dueCount: null,
        dispatched: null,
        worked: [],
        dispositions: [],
        dispatchDetails: [],
        research: null,
        deferred: null,
        debts: null,
        incidents: [],
        risk: null,
        health: null,
        promotedToReaderTruth: false,
        failure: { code: "CYCLE_CRASHED", detail: pendingLine === null ? message : `${message}\n${pendingLine}` },
      };
      try {
        await runBoundedStep({
          label: "crash:digest-append",
          budgetMs: input.digestBudgetMs,
          fn: () => appendFreshnessCycleDigest(repos, { outcome, lines }),
        });
        canonical = "APPENDED";
        input.log(`\n  canonical outcome: ${input.cycleId}`);
      } catch (recordError) {
        canonical = "NOT_APPENDED";
        input.log(
          `\n  freshness:shadow CRASHED and the canonical outcome append failed (${recordError instanceof Error ? recordError.message : String(recordError)}).`,
        );
      }
    }
  }

  let recordPath: string | null = null;
  try {
    recordPath = input.writeLocalRecord({
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      cycleId: input.cycleId,
      testedSha: input.testedSha,
      crashed: true,
      error: message,
      canonicalOutcome: canonical,
      pending: input.pending,
      digest: lines,
    });
  } catch (writeError) {
    input.log(
      `\n  freshness:shadow CRASHED and could not write a run record (${writeError instanceof Error ? writeError.message : String(writeError)}): ${headline}`,
    );
  }
  return { canonical, recordPath, lines };
}
