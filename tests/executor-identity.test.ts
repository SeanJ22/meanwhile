/**
 * **THE RECORDED EXECUTOR MUST BE THE ONE THAT RAN.**
 * (Session B closure, W3.E, 2026-08-31.)
 *
 * `chooseExecutor` DECIDES and the injected worker RUNS, and nothing connected
 * the two. The dispatcher recorded the decision as though it were the fact.
 *
 * It was wrong on every cycle of the 2026-08-31 shadow runs, which recorded
 * **10 BOUNDED_MODEL_WORKER Attempts for work a deterministic HTTP walker
 * did** — because nothing in the method store joins a meetings publisher to a
 * graduated route, so every meetings obligation is classified ungraduated and
 * routed to the model lane, and the runner then injects the HTTP walker anyway.
 *
 * That is a cost and provenance defect. An Attempt labelled as a model worker
 * invites a reader of the ledger to attribute model spend and model variance to
 * a run that had neither.
 *
 * The arrangement itself is legitimate. What was not legitimate is that nothing
 * said so.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { dispatchOne, type RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
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

/** A deterministic walker, whatever the dispatcher decided. */
const deterministicWalker: RunWork = async () => ({
  ranAs: "DETERMINISTIC",
  kind: "DISPOSED",
  disposition: {
    disposition: "WALKED_NO_YIELD",
    observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: 0, earliest: null, latest: null },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "reached, nothing there",
  },
  detail: "walked",
});

test("SEEDED W3.E: an UNGRADUATED route routed to the model lane, walked deterministically, RECORDS deterministic", async () => {
  const { repos, task } = await fixture();

  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    /* Exactly the shadow runner's situation: nothing is graduated. */
    maturity: () => "UNGRADUATED",
    run: deterministicWalker,
  });

  assert.equal(
    result.executorChosen,
    "BOUNDED_MODEL_WORKER",
    "the decision is unchanged — an ungraduated route still routes to the bounded lane",
  );
  assert.equal(
    result.executor,
    "DETERMINISTIC",
    "and the RECORD says what ran. Before this it said BOUNDED_MODEL_WORKER, which was the " +
      "decision wearing the fact's name — 10 such Attempts on 2026-08-31 alone",
  );
  assert.equal(
    result.executorMismatch,
    true,
    "the disagreement is recorded rather than hidden; a seam that ignores the decision is a " +
      "real arrangement and the defect was that nothing said so",
  );
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
    run: deterministicWalker,
  });
  assert.equal(result.executorChosen, "DETERMINISTIC");
  assert.equal(result.executor, "DETERMINISTIC");
  assert.equal(
    result.executorMismatch,
    false,
    "a flag that were always true would carry no information",
  );
});

test("SEEDED W3.E: a worker claiming the MODEL lane is recorded as the model lane", async () => {
  /*
   * The mirror case, and the one that matters for cost. If a model worker runs
   * where a deterministic walker was chosen, the ledger must say a model ran —
   * otherwise model spend is attributed to a deterministic Attempt.
   */
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    run: async () => ({ ...(await deterministicWalker({} as never)), ranAs: "BOUNDED_MODEL_WORKER" }),
  });
  assert.equal(result.executorChosen, "DETERMINISTIC");
  assert.equal(result.executor, "BOUNDED_MODEL_WORKER");
  assert.equal(result.executorMismatch, true);
});
