/**
 * The persisted Attempt must carry the identity of the thing that ran, not the lane the dispatcher chose, and the
 * cost ledger keyed on that Attempt inherits it. Every assertion that matters reopens the persisted Attempt rather
 * than reading the returned object.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  dispatchOne,
  type DeclaredExecutor,
  type RunWork,
} from "../lib/control-plane/scheduler/dispatch.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-08-31T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function obligation(): FreshnessObligation {
  return {
    id: "ob-1",
    recordClass: "meetings",
    subjectId: "ocd-division/country:us/state:az/county:pima",
    routeId: "SOME_ROUTE",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
  };
}

function scheduled() {
  const row = scheduleObligation(obligation(), NOW_MS);
  assert.ok(isScheduled(row));
  return row;
}

async function fixture() {
  const repos = await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-exec-")));
  const item = createWorkItem({
    project: "freshness",
    subject: "subject",
    obligation: "refresh:meetings",
    why: "executor identity test",
    now: NOW,
  });
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "SOME_ROUTE",
    routeLabel: "route",
    target: "target",
    inherited: true,
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  await registerRouteTask(repos, task, NOW);
  return { repos, task };
}

const walk: RunWork = async () => ({
  ranAs: "DETERMINISTIC",
  kind: "DISPOSED",
  disposition: {
    disposition: "WALKED_NO_YIELD",
    observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: 0, earliest: null, latest: null },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "reached, nothing there",
  },
  cost: {
    inputTokens: null,
    outputTokens: null,
    usd: null,
    durationMs: 120,
    bytesFetched: 4096,
    requestCount: 1,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    cacheCreation5mInputTokens: null,
    cacheCreation1hInputTokens: null,
    uncachedInputTokens: null,
    batch: false,
  },
  detail: "walked",
});

/** A deterministic walker that says so before it runs. */
const deterministic: DeclaredExecutor = {
  lane: "DETERMINISTIC",
  workerFor: ({ holder }) => ({
    role: "ACQUIRER",
    provider: "we-the-people",
    version: "http-executor/1.0",
    instance: holder,
  }),
  run: walk,
};

test("SEEDED W3.E: the PERSISTED Attempt carries the deterministic worker, not the chosen lane's", async () => {
  const { repos, task } = await fixture();

  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    /* Exactly the shadow runner's situation: nothing is graduated, so the
       method store routes this to the bounded MODEL lane. */
    maturity: () => "UNGRADUATED",
    executor: deterministic,
  });

  assert.equal(result.executorChosen, "BOUNDED_MODEL_WORKER", "the decision is unchanged");
  assert.equal(result.executor, "DETERMINISTIC", "and the result says what ran");
  assert.equal(result.executorMismatch, true, "the disagreement is recorded, not hidden");

  /* Reopened from the store, not read off the returned object. */
  const attempts = await attemptsForRouteTask(repos, task.id);
  assert.equal(attempts.length, 1);
  const persisted = attempts[0].value;

  assert.equal(
    persisted.worker.provider,
    "we-the-people",
    "the durable Attempt said `anthropic` for work no model touched",
  );
  assert.equal(persisted.worker.version, "http-executor/1.0");
  assert.notEqual(persisted.worker.version, "unspecified-model");
  assert.equal(persisted.worker.role, "ACQUIRER");
  assert.equal(persisted.outcome, "COMPLETED");

  /* Cost attribution rides on that same Attempt, so it inherits the identity. */
  const costs = await repos.costs.readAll();
  const mine = costs.filter((c) => c.attemptId === persisted.id);
  assert.equal(mine.length, 1, "the walk recorded a cost entry");
  assert.equal(mine[0].role, "ACQUIRER", "cost is attributed to the role that actually ran");
  assert.equal(
    mine[0].cost.inputTokens,
    null,
    "no model ran, so model tokens are null — never zero, which would read as a measured model",
  );
  assert.equal(mine[0].cost.requestCount, 1);
});

test("W3.E: agreement is recorded as agreement, so a mismatch means something", async () => {
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: deterministic,
  });
  assert.equal(result.executorChosen, "DETERMINISTIC");
  assert.equal(result.executor, "DETERMINISTIC");
  assert.equal(result.executorMismatch, false, "a flag that were always true would say nothing");
});

test("SEEDED W3.E: a worker CONTRADICTING its own declaration is REFUSED, not reconciled", async () => {
  /*
   * The Attempt is persisted on the executor's word. An outcome claiming a
   * different lane means that durable record is already wrong on the
   * executor's own account, and reconciling it would mean choosing which of
   * two statements from the same party to believe.
   */
  const { repos, task } = await fixture();
  const liar: DeclaredExecutor = {
    lane: "DETERMINISTIC",
    workerFor: deterministic.workerFor,
    run: async () => ({ ...(await walk({} as never)), ranAs: "BOUNDED_MODEL_WORKER" }),
  };

  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: liar,
  });

  assert.equal(result.outcome, "FAILED");
  assert.equal(result.dispositionCommitted, false, "no conclusion is written on a masquerade");
  assert.match(result.detail, /masquerade is not a disagreement/);

  const attempts = await attemptsForRouteTask(repos, task.id);
  assert.equal(attempts[0].value.outcome, "DENIED_BY_POLICY");
  const settled = await repos.routeTasks.mustRead(task.id);
  assert.equal(settled.value.disposition, null, "and the route stays owed");
});

test("W3.E: a declared MODEL lane persists the model identity", async () => {
  /* The mirror, and the one that matters for spend: if a model runs, the
     durable Attempt must say so, or model cost lands on a deterministic row. */
  const { repos, task } = await fixture();
  const model: DeclaredExecutor = {
    lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({
      role: "SCOUT",
      provider: "anthropic",
      version: "claude-haiku-4-5-20251001",
      instance: holder,
    }),
    run: async () => ({ ...(await walk({} as never)), ranAs: "BOUNDED_MODEL_WORKER" }),
  };

  await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "UNGRADUATED",
    executor: model,
  });

  const attempts = await attemptsForRouteTask(repos, task.id);
  const persisted = attempts[0].value;
  assert.equal(persisted.worker.provider, "anthropic");
  assert.equal(persisted.worker.version, "claude-haiku-4-5-20251001");
  assert.equal(persisted.worker.role, "SCOUT");
});
