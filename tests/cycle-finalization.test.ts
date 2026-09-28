/**
 * **THE RESEARCH CYCLE'S FINALIZATION COMPLETES OR FAILS BY NAME, INSIDE THE
 * WALL — A HUNG STORE RECORDS FAILED, IT DOES NOT HANG.**
 * (Runner bounded store calls, 2026-09-23.)
 *
 * On 2026-09-23 at 17:32:59Z a research cycle finished every phase, wrote its
 * research state, and then produced nothing until the supervisor's SIGTERM
 * 4.5 minutes later: no heartbeat, no FRESHNESS_CYCLE digest, no local record,
 * nothing on stderr. These tests drive the finalization's own pieces against a
 * control plane whose fetch never answers — the real `createPgRepositories`,
 * no network — and hold that each step fails by name inside its budget, the
 * crash path appends FAILED where it can and always writes the local crash
 * record, and the whole thing settles in milliseconds, not at a wall.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { neonConfig } from "@neondatabase/serverless";

import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import { appendFreshnessCycleDigest, freshnessCycleOutcomes } from "../lib/control-plane/freshness-cycle-outcome.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import { withControlPlaneConnectRetry } from "../lib/control-plane/repository/connect-retry.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { isControlPlaneRequestTimeout, type ControlPlaneRequestTimeout } from "../lib/control-plane/repository/request-bounds.ts";
import {
  ADMIN_VISIBLE_FINALIZATION_MS,
  CYCLE_FINALIZATION_BUDGETS_MS,
  CycleStepTimeout,
  DIGEST_AND_RECORD_RESERVE_MS,
  LOCAL_RECORD_RESERVE_MS,
  RECORDS_MARGIN_BEFORE_WALL_MS,
  cycleClock,
  lateWorkDeadlineMs,
  recordFailedCycle,
  runBoundedStep,
  stepBudgetMs,
} from "../lib/control-plane/scheduler/cycle-finalization.ts";
import { PendingOperations, trackStoreCalls } from "../lib/control-plane/scheduler/cycle-stall.ts";

const URL = "postgresql://user:pass@ep-cycle-finalization-proof.us-east-2.aws.neon.tech/neondb";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The driver's fetch hook replaced by one that never answers (it honours the abort, as undici does). */
async function withHungStore<T>(fn: () => Promise<T>): Promise<T> {
  const original = neonConfig.fetchFunction;
  neonConfig.fetchFunction = ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof neonConfig.fetchFunction;
  try {
    return await fn();
  } finally {
    neonConfig.fetchFunction = original;
  }
}

function succeededOutcome(cycleId: string): FreshnessCycleOutcome {
  return {
    kind: "FRESHNESS_CYCLE", state: "SUCCEEDED", cycleId, startedAt: "2026-09-23T17:32:59.000Z", finishedAt: "2026-09-23T17:43:10.000Z",
    testedSha: "a".repeat(40), host: "test-host", provider: "test", durable: true, executor: "route-aware + scout", registry: null,
    obligations: 1, occurrencesOpened: 0, debtInherited: 0, debtPersisted: 0, debtCleared: 0, scheduled: 1, unscheduled: [], dueCount: 0,
    dispatched: 0, worked: [], dispositions: [], dispatchDetails: [], research: null, deferred: 0, debts: 0, incidents: [], risk: null,
    health: null, promotedToReaderTruth: false, failure: null,
  };
}

test("the clock: the stall diagnostic fires 90 s before the wall and every record settles 15 s before it", () => {
  const clock = cycleClock({ processStartedMs: 0, wallMs: 15 * 60_000, stallLeadMs: 90_000 });
  assert.equal(clock.wallAtMs, 900_000);
  assert.equal(clock.stallAtMs, 810_000);
  assert.equal(clock.recordsDeadlineMs, 900_000 - RECORDS_MARGIN_BEFORE_WALL_MS);
  const tiny = cycleClock({ processStartedMs: 1_000, wallMs: 30_000, stallLeadMs: 90_000 });
  assert.equal(tiny.stallAtMs, 1_000, "a wall shorter than the lead fires at once, never before the process began");
});

test("a step gets its own budget, cut so the canonical outcome and the local record keep theirs; none is started with no time", () => {
  const deadlineMs = 885_000;
  /* A usual cycle ends its phases near ten minutes: every step gets its full budget. */
  assert.equal(stepBudgetMs({ nowMs: 600_000, budgetMs: 25_000, deadlineMs, reservedAfterMs: DIGEST_AND_RECORD_RESERVE_MS }), 25_000);
  /* A late one: the heartbeat is cut to what the digest's reserve leaves, then to nothing. */
  assert.equal(stepBudgetMs({ nowMs: 830_000, budgetMs: 25_000, deadlineMs, reservedAfterMs: DIGEST_AND_RECORD_RESERVE_MS }), 5_000);
  assert.equal(stepBudgetMs({ nowMs: 840_000, budgetMs: 25_000, deadlineMs, reservedAfterMs: DIGEST_AND_RECORD_RESERVE_MS }), 0);
  /* The digest itself is still granted its time then, less the local record's reserve. */
  assert.equal(stepBudgetMs({ nowMs: 840_000, budgetMs: 45_000, deadlineMs, reservedAfterMs: LOCAL_RECORD_RESERVE_MS }), 40_000);

  /* Every step spends its whole grant, from a late start: the records still end by the deadline. */
  for (const start of [600_000, 780_000, 830_000, 860_000]) {
    let now = start;
    const order: [number, number][] = [
      [CYCLE_FINALIZATION_BUDGETS_MS.researchState, DIGEST_AND_RECORD_RESERVE_MS],
      [CYCLE_FINALIZATION_BUDGETS_MS.codeIdentity, DIGEST_AND_RECORD_RESERVE_MS],
      [CYCLE_FINALIZATION_BUDGETS_MS.heartbeat, DIGEST_AND_RECORD_RESERVE_MS],
      [CYCLE_FINALIZATION_BUDGETS_MS.digestAppend, LOCAL_RECORD_RESERVE_MS],
    ];
    for (const [budgetMs, reservedAfterMs] of order) now += stepBudgetMs({ nowMs: now, budgetMs, deadlineMs, reservedAfterMs });
    assert.ok(now <= deadlineMs - LOCAL_RECORD_RESERVE_MS, `from ${start} ms the digest settles at ${now} ms, leaving the local record its time`);
  }
});

test("a step whose await never settles fails by name after its budget; one with no time is not started", async () => {
  const started = performance.now();
  await assert.rejects(
    runBoundedStep({ label: "code-identity", budgetMs: 50, fn: () => new Promise<never>(() => {}) }),
    (error: unknown) =>
      error instanceof CycleStepTimeout && error.step === "code-identity" && /did not finish within its 50 ms budget/.test(error.message),
  );
  assert.ok(performance.now() - started < 1_000);
  await assert.rejects(
    runBoundedStep({ label: "heartbeat", budgetMs: 0, fn: async () => "never" }),
    /CYCLE_STEP_TIMEOUT: heartbeat was not started; no time was left for it before the wall/,
  );
});

test("a hung store call inside a step is cut at the step's budget under its own name, not the step's", async () => {
  await withHungStore(async () => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true });
    const started = performance.now();
    await assert.rejects(runBoundedStep({ label: "heartbeat", budgetMs: 80, fn: () => repos.runnerHeartbeat.read("pilot-runner") }), (error: unknown) => {
      assert.ok(isControlPlaneRequestTimeout(error), String(error));
      const timeout = error as ControlPlaneRequestTimeout;
      assert.equal(timeout.operation, "cp_runner_heartbeat.read");
      assert.equal(timeout.kind, "DEADLINE");
      assert.equal(timeout.budget, "heartbeat");
      return true;
    });
    assert.ok(performance.now() - started < 1_000);
  });
});

test("a hung store: the canonical outcome's append fails by name inside its budget, and the cycle records FAILED instead of hanging", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-cycle-finalization-"));
  try {
    await withHungStore(async () => {
      const pending = new PendingOperations();
      pending.phaseFinished("metrics-and-finalization");
      const repos = trackStoreCalls(await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true }), pending);
      const cycleId = "freshness-cycle:test-host:2026-09-23T17:32:59.000Z";
      const started = performance.now();

      /* The finalization's digest step, exactly as the cycle runs it. */
      const appending = pending.step("digest:append", () =>
        runBoundedStep({
          label: "digest:append",
          budgetMs: 200,
          fn: () =>
            withControlPlaneConnectRetry(
              () => appendFreshnessCycleDigest(repos, { outcome: succeededOutcome(cycleId), lines: ["PILOT HEALTH"] }),
              { maxAttempts: 3, sleep: async () => {} },
            ),
        }));
      const settled = appending.then(() => null, (error: unknown) => error);
      await sleep(60);
      const waiting = pending.snapshot();
      assert.deepEqual(waiting.steps.map((s) => s.label), ["digest:append"], "while it waits, the account names the await");
      assert.deepEqual(waiting.store.map((c) => c.call), ["ownerDigests.append"], "and the store call");
      const error = await settled;
      assert.ok(isControlPlaneRequestTimeout(error), `named: ${String(error)}`);
      assert.match((error as Error).message, /cp_log_owner_digests\.append:probe \(DOCUMENT\) did not settle within the \d+ ms left in the budget of digest:append/);
      assert.ok(performance.now() - started < 1_200, "inside its budget, not at a wall");

      /* The crash handler's path: FAILED where the store allows it, the local crash record always. */
      const logged: string[] = [];
      const crashStarted = performance.now();
      const failed = await recordFailedCycle({
        repos,
        error,
        cycleId,
        startedAt: "2026-09-23T17:32:59.000Z",
        finishedAt: "2026-09-23T17:43:31.000Z",
        testedSha: "a".repeat(40),
        host: "test-host",
        pending: pending.snapshot(),
        digestBudgetMs: 150,
        writeLocalRecord: (record) => {
          const path = join(dir, "2026-09-23-07.json");
          writeFileSync(path, JSON.stringify(record));
          return path;
        },
        log: (line) => logged.push(line),
      });
      assert.ok(performance.now() - crashStarted < 1_200, "the crash path is bounded too");
      assert.equal(failed.canonical, "NOT_APPENDED");
      assert.match(logged.join("\n"), /the canonical outcome append failed \(CONTROL_PLANE_REQUEST_TIMEOUT: cp_log_owner_digests\.append:probe/);
      const record = JSON.parse(readFileSync(failed.recordPath!, "utf8"));
      assert.equal(record.crashed, true);
      assert.equal(record.cycleId, cycleId);
      assert.equal(record.canonicalOutcome, "NOT_APPENDED");
      assert.match(record.error, /^ControlPlaneRequestTimeout: CONTROL_PLANE_REQUEST_TIMEOUT: cp_log_owner_digests\.append:probe/);
      assert.equal(record.pending.lastFailed.label, "digest:append", "the failed await is named after it was left");
      assert.equal(record.pending.lastPhase, "metrics-and-finalization");
      assert.match(record.digest.join("\n"), /pending: no labelled await; last failed await: digest:append at .*; last phase: metrics-and-finalization/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("an answering store gets the FAILED outcome, naming the timeout and what was pending", async () => {
  const repos = createMemoryRepositories();
  const pending = new PendingOperations();
  pending.phaseFinished("metrics-and-finalization");
  const leave = pending.enter("heartbeat:write");
  const timeoutError = Object.assign(
    new Error("CONTROL_PLANE_REQUEST_TIMEOUT: cp_runner_heartbeat.compareAndSet (POINT) did not settle within its 10000 ms request bound"),
    { name: "ControlPlaneRequestTimeout" },
  );
  let written: Record<string, unknown> | null = null;
  const failed = await recordFailedCycle({
    repos,
    error: timeoutError,
    cycleId: "freshness-cycle:test-host:2026-09-23T21:35:02.000Z",
    startedAt: "2026-09-23T21:35:02.000Z",
    finishedAt: "2026-09-23T21:48:40.000Z",
    testedSha: null,
    host: "test-host",
    pending: pending.snapshot(),
    digestBudgetMs: 5_000,
    writeLocalRecord: (record) => {
      written = record;
      return "memory";
    },
    log: () => {},
  });
  leave();
  assert.equal(failed.canonical, "APPENDED");
  const outcomes = freshnessCycleOutcomes(await repos.ownerDigests.readWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE"));
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.state, "FAILED");
  assert.equal(outcomes[0]!.failure?.code, "CYCLE_CRASHED");
  assert.match(outcomes[0]!.failure?.detail ?? "", /CONTROL_PLANE_REQUEST_TIMEOUT: cp_runner_heartbeat\.compareAndSet/);
  assert.match(outcomes[0]!.failure?.detail ?? "", /pending: heartbeat:write; last phase: metrics-and-finalization/);
  assert.equal((written as Record<string, unknown> | null)?.canonicalOutcome, "APPENDED");
});

test("with no time left before the wall, the local crash record still carries the failure, and says the append was not tried", async () => {
  const logged: string[] = [];
  let written: Record<string, unknown> | null = null;
  const failed = await recordFailedCycle({
    repos: createMemoryRepositories(),
    error: new Error("late"),
    cycleId: "freshness-cycle:test-host:late",
    startedAt: "2026-09-23T19:34:18.000Z",
    finishedAt: "2026-09-23T19:49:05.000Z",
    testedSha: null,
    host: "test-host",
    pending: null,
    digestBudgetMs: 0,
    writeLocalRecord: (record) => {
      written = record;
      return "memory";
    },
    log: (line) => logged.push(line),
  });
  assert.equal(failed.canonical, "NO_TIME");
  assert.equal(failed.recordPath, "memory");
  assert.equal((written as Record<string, unknown> | null)?.crashed, true);
  assert.match(logged.join("\n"), /no time was left before the wall for the canonical FAILED outcome/);
});

/*
 * **THE LATE WORK YIELDS BEFORE IT TAKES THE RECORDS ADMIN READS.** (2026-09-26.)
 *
 * The first research cycle on fb84b6f0 (2026-09-26 03:54:05Z) ran the worker fleet's fact projection from 737 s
 * to 835 s of its fifteen-minute wall. Its finalization then began with no time before the digest's reserve:
 * "the final research state was not written: CYCLE_STEP_TIMEOUT: research-state:final was not started; no time
 * was left for it before the wall; the runner heartbeat could not be written" — while the digest said
 * SUCCEEDED. Admin's runner card kept the previous cycle (03:49Z) and the previous code, and Fleet's lanes read
 * "mid-cycle" from 03:55Z. The late work was bounded only by the stall point (810 s), which leaves 25 s for the
 * 100 s the research state, the code identity and the heartbeat declare.
 */
test("the late work yields at 735 s on the fifteen-minute wall, which leaves every finalization step its whole budget", () => {
  const clock = cycleClock({ processStartedMs: 0, wallMs: 15 * 60_000, stallLeadMs: 90_000 });
  const deadline = lateWorkDeadlineMs(clock);
  assert.equal(ADMIN_VISIBLE_FINALIZATION_MS, 100_000);
  assert.equal(deadline, 735_000);
  assert.ok(deadline < clock.stallAtMs, "earlier than the stall point, which left the Admin-visible steps 25 s");

  /* Finalization that starts at the late-work deadline: each step is granted all of its own budget. */
  let now = deadline;
  for (const [label, budgetMs] of [
    ["research-state:final", CYCLE_FINALIZATION_BUDGETS_MS.researchState],
    ["code-identity", CYCLE_FINALIZATION_BUDGETS_MS.codeIdentity],
    ["heartbeat", CYCLE_FINALIZATION_BUDGETS_MS.heartbeat],
  ] as const) {
    const granted = stepBudgetMs({ nowMs: now, budgetMs, deadlineMs: clock.recordsDeadlineMs, reservedAfterMs: DIGEST_AND_RECORD_RESERVE_MS });
    assert.equal(granted, budgetMs, `${label} keeps its whole budget even when every earlier step spends all of its own`);
    now += granted;
  }
  const digest = stepBudgetMs({ nowMs: now, budgetMs: CYCLE_FINALIZATION_BUDGETS_MS.digestAppend, deadlineMs: clock.recordsDeadlineMs, reservedAfterMs: LOCAL_RECORD_RESERVE_MS });
  assert.equal(digest, CYCLE_FINALIZATION_BUDGETS_MS.digestAppend, "and the digest still has its own");
});

test("2026-09-26: late work still running at 835 s left the research state no time; the late-work deadline never admits the projection there", () => {
  const clock = cycleClock({ processStartedMs: 0, wallMs: 15 * 60_000, stallLeadMs: 90_000 });
  const researchStateBudgetFrom = (finalizationStartsMs: number): number =>
    stepBudgetMs({ nowMs: finalizationStartsMs, budgetMs: CYCLE_FINALIZATION_BUDGETS_MS.researchState, deadlineMs: clock.recordsDeadlineMs, reservedAfterMs: DIGEST_AND_RECORD_RESERVE_MS });
  /* The failure as it was: the late work ended at 835 s, and the research state was not started. */
  assert.equal(researchStateBudgetFrom(835_000), 0);
  /* That projection began at 737 s: past the late-work deadline, so it is granted nothing and never started. */
  assert.equal(Math.max(0, lateWorkDeadlineMs(clock) - 737_000), 0);
  /* One that began at 685 s (the 02:24Z cycle) is granted 50 s, and finalization then starts with its whole budgets. */
  assert.equal(Math.max(0, lateWorkDeadlineMs(clock) - 685_000), 50_000);
  assert.equal(researchStateBudgetFrom(lateWorkDeadlineMs(clock)), CYCLE_FINALIZATION_BUDGETS_MS.researchState);
});

test("the late-work deadline is never before the process began and never after the stall point, on any wall", () => {
  for (const wallMs of [0, 30_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]) {
    const clock = cycleClock({ processStartedMs: 1_000, wallMs, stallLeadMs: 90_000 });
    const deadline = lateWorkDeadlineMs(clock);
    assert.ok(deadline >= clock.processStartedMs, `wall ${wallMs}: not before the process began`);
    assert.ok(deadline <= clock.stallAtMs, `wall ${wallMs}: not after the stall point`);
  }
});

test("the research cycle bounds its late work by the late-work deadline: the metrics, the progression and the fact projection", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "freshness-shadow.mts"), "utf8");
  assert.match(source, /const lateWorkBudgetMs = \(\): number => Math\.max\(0, lateWorkDeadlineMs\(CLOCK\) - Date\.now\(\)\);/);
  assert.doesNotMatch(source, /CLOCK\.stallAtMs - Date\.now\(\)/, "no late work is bounded by the stall point alone");
  assert.match(source, /withStoreBudget\("metrics", lateWorkBudgetMs\(\), computeMetrics\)/);
  assert.match(source, /withStoreBudget\("research-progression", lateWorkBudgetMs\(\)/);
  /* The projection runs inside a bounded step whose budget is the late work's, and a yield is named, never a crash. */
  assert.match(
    source,
    /pending\.step\(phase, \(\) => runBoundedStep\(\{\s*label: phase,\s*budgetMs: Math\.min\(120_000, lateWorkBudgetMs\(\)\),\s*fn: \(\) => projectFleetPipeline\(/,
  );
  assert.match(source, /retained records remain owed, existing reader data is preserved/);
  const retained = source.indexOf('await projectRetainedFacts("retained-results:fact-projection")');
  assert.ok(retained > 0 && retained < source.indexOf("const cycle = await runCycle("), "retained verification cannot be starved behind new acquisition");
  assert.match(source, /if \(!dry && !canary && \(!scheduledBlackout \|\| hasLifetimeHunt\)\) await projectRetainedFacts/, "normal operating controls and the exact original-hunt exception govern the pass");
  assert.match(source, /if \(fleetDispatches\.some\(row => row\.outcome === "WORKED"\)\) await projectRetainedFacts\("new-worker-results:fact-projection"\)/, "only new worker output justifies the second pass");
});
