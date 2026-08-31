/**
 * **THE CANONICAL FRESHNESS LIFECYCLE.** (Session B resume, W3.A/B/C.)
 *
 * Every test here is written against a defect that was live on `main` at
 * 68a70354 and that the existing suite could not see, because the existing
 * suite's executor stub returned `{ ok: true }` — which the old seam read as a
 * completed walk. A suite whose double cannot express "I did nothing" cannot
 * fail a scheduler that treats doing nothing as success.
 *
 * The four the audit found, restated as things that must now be false:
 *
 * ```
 *   a no-op executor counts as WORKED
 *   a no-op executor clears freshness debt
 *   a WORKED result exists with no Attempt and no disposition
 *   two occurrences of one obligation share a RouteTask
 * ```
 *
 * These are unit-level. The LIVE proofs — two-process contention, a real
 * `process.exit` kill, concurrent append positions, cross-process debt
 * inheritance, a dump/wipe/restore — are `pnpm control-plane:proof`, because
 * none of them can be performed honestly inside one process.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  DISCHARGING_DISPOSITIONS,
  dischargesObligation,
  dispatchOne,
  type RunWork,
} from "../lib/control-plane/scheduler/dispatch.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import {
  closeOccurrence,
  loadDebts,
  openOccurrence,
  persistDebts,
  standing,
} from "../lib/control-plane/scheduler/durable.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { httpExecutor, type FetchOutcome } from "../lib/control-plane/scheduler/http-executor.ts";

const NOW = "2026-08-31T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function obligation(over: Partial<FreshnessObligation> = {}): FreshnessObligation {
  return {
    id: "ob-1",
    recordClass: "meetings",
    subjectId: "ocd-division/country:us/state:az/place:tucson",
    routeId: "PROOF_ROUTE",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
    ...over,
  };
}

function scheduled(o: FreshnessObligation = obligation()) {
  const row = scheduleObligation(o, NOW_MS);
  assert.ok(isScheduled(row));
  return row;
}

async function fixture() {
  const repos = await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-life-")));
  const item = createWorkItem({
    project: "freshness",
    subject: "subject",
    obligation: "refresh:meetings",
    why: "lifecycle test",
    now: NOW,
  });
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "PROOF_ROUTE",
    routeLabel: "proof",
    target: "target",
    inherited: true,
    now: NOW,
  });
  await registerWorkItem(repos, item, NOW);
  await registerRouteTask(repos, task, NOW);
  return { repos, item, task };
}

const READING: RunWork = async () => ({
  ranAs: "DETERMINISTIC",
  kind: "DISPOSED",
  disposition: {
    disposition: "WALKED_NO_YIELD",
    observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: 0, earliest: null, latest: null },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "reached, and it had nothing",
  },
  detail: "walked",
});

/* ==================================================== the no-op executor === */

test("SEEDED W3.A: a no-op executor is SIMULATED — never WORKED, and it discharges nothing", async () => {
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async () => ({
        ranAs: "DETERMINISTIC",
        kind: "SIMULATED",
        detail: "decided, did not retrieve",
      }),
    },
  });

  assert.equal(result.outcome, "SIMULATED");
  assert.equal(result.dispositionCommitted, false);
  assert.equal(result.disposition, null);
  assert.equal(
    dischargesObligation(result),
    false,
    "this is the defect exactly: the previous seam returned ok:true here and the loop deleted " +
      "the obligation's debt on the strength of it",
  );

  /* And the route is left OWED, not settled. */
  const settled = await repos.routeTasks.mustRead(task.id);
  assert.equal(settled.value.disposition, null);
  assert.equal(settled.value.state, "RECLAIMABLE");
});

/* ================================================== WORKED means something === */

test("W3.A: a WORKED result carries an Attempt, a committed disposition and a released lease", async () => {
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: READING },
  });

  assert.equal(result.outcome, "WORKED");
  assert.equal(result.dispositionCommitted, true);
  assert.equal(result.disposition, "WALKED_NO_YIELD");
  assert.ok(dischargesObligation(result));

  /*
   * The four things the old dispatchOne never did. Asserted against the STORE
   * rather than against the returned object, because the returned object is
   * what the old version got right.
   */
  assert.ok(result.attemptId, "an Attempt was opened");
  const attempts = await attemptsForRouteTask(repos, task.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].value.outcome, "COMPLETED");
  assert.equal(attempts[0].value.id, result.attemptId);

  const disposed = await repos.routeTasks.mustRead(task.id);
  assert.equal(disposed.value.disposition?.disposition, "WALKED_NO_YIELD");

  const lease = await repos.leases.mustRead(task.id);
  assert.equal(lease.value.released, true, "the lease is released, not left to expire");

  const commits = await repos.dispositions.read(task.id);
  assert.equal(commits.length, 1, "and the disposition is in the replayable log");
});

/* ============================================ a wall is not a fresh reading === */

test("SEEDED W3.A: a BLOCKED_CURRENTLY disposition closes the route and discharges NOTHING", async () => {
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async () => ({
        ranAs: "DETERMINISTIC",
        kind: "DISPOSED",
        disposition: {
          disposition: "BLOCKED_CURRENTLY",
          observation: null,
          permission: "CANNOT_TELL",
          transport: "CHALLENGED",
          note: "HTTP 403 to this client",
        },
        detail: "a wall",
      }),
    },
  });

  assert.equal(result.outcome, "WORKED", "the dispatch did reach a terminal disposition");
  assert.equal(result.dispositionCommitted, true);
  assert.equal(
    dischargesObligation(result),
    false,
    "a blocked route may never become a blocked fact, and it may not refresh a record either",
  );
  assert.ok(!DISCHARGING_DISPOSITIONS.includes("BLOCKED_CURRENTLY"));
});

/* ================================================= a thrown worker aborts === */

test("W3.A: a worker that throws leaves NO disposition and the route stays owed", async () => {
  const { repos, task } = await fixture();
  const result = await dispatchOne(repos, {
    obligation: scheduled(),
    routeTaskId: task.id,
    holder: "w",
    now: NOW,
    leaseTtlMs: 60_000,
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async () => {
        throw new Error("the parser exploded");
      },
    },
  });

  assert.equal(result.outcome, "FAILED");
  assert.equal(result.dispositionCommitted, false);
  const attempts = await attemptsForRouteTask(repos, task.id);
  assert.equal(attempts[0].value.outcome, "ABORTED");
  assert.match(String(attempts[0].value.abortReason), /the parser exploded/);
  const settled = await repos.routeTasks.mustRead(task.id);
  assert.equal(settled.value.disposition, null, "our failure describes no government");
});

/* ================================================= recurrence, W3.B ======== */

test("SEEDED W3.B: two occurrences of one obligation NEVER share a RouteTask", async () => {
  const repos = createMemoryRepositories();
  const o = standing(obligation(), NOW);
  await repos.obligations.put(o.id, o, NOW);

  const first = await openOccurrence(repos, { obligation: o, dueAt: NOW, now: NOW });
  assert.ok(first);
  await closeOccurrence(repos, {
    occurrenceId: first.occurrence.id,
    disposition: "INGESTED",
    unresolvedReason: null,
    now: NOW,
  });

  const afterFirst = (await repos.obligations.mustRead(o.id)).value;
  assert.equal(afterFirst.occurrenceCount, 1);
  assert.equal(afterFirst.openOccurrenceId, null);
  assert.equal(afterFirst.lastWorkedAt, NOW, "a discharged occurrence moves the anchor");

  const second = await openOccurrence(repos, { obligation: afterFirst, dueAt: NOW, now: NOW });
  assert.ok(second);

  assert.notEqual(
    first.routeTask.id,
    second.routeTask.id,
    "a disposed RouteTask is settled and cannot be the container for the next reading. The " +
      "previous runner reused one task per obligation and only got away with it because the " +
      "fake executor never disposed of anything.",
  );
  assert.notEqual(first.workItem.id, second.workItem.id);
  assert.equal(second.occurrence.sequence, 2);
});

test("W3.B: an occurrence that closes UNRESOLVED does not move the freshness anchor", async () => {
  const repos = createMemoryRepositories();
  const o = standing(obligation(), NOW);
  await repos.obligations.put(o.id, o, NOW);
  const occ = await openOccurrence(repos, { obligation: o, dueAt: NOW, now: NOW });
  assert.ok(occ);

  await closeOccurrence(repos, {
    occurrenceId: occ.occurrence.id,
    disposition: null,
    unresolvedReason: "the host refused this client",
    now: NOW,
  });

  const after = (await repos.obligations.mustRead(o.id)).value;
  assert.equal(
    after.lastWorkedAt,
    o.lastWorkedAt,
    "advancing the anchor on a failure would push the next check further out FOR HAVING FAILED, " +
      "which is the one direction a freshness clock must never drift",
  );
});

/* ================================================= durable debt, W3.C ====== */

test("SEEDED W3.C: freshness debt survives a store round-trip and keeps its ORIGINAL age", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-debt-"));
  const repos = await createFileRepositories(root);
  const debt = recordFailure(null, {
    obligationId: "ob-1",
    cause: "TRANSPORT_FAILED",
    detail: "nothing was reached",
    target: "example.invalid",
    dueAt: NOW,
    now: NOW,
  });
  await persistDebts(repos, [debt], NOW);

  /* A DIFFERENT repository handle over the same root, holding NO reference to
     the first — the closest a single process gets to "a fresh process". The
     genuine two-process proof is `pnpm control-plane:proof` P6, where one OS
     process writes the debt, exits, and another reads it back. */
  const reopened = await createFileRepositories(root);
  const loaded = await loadDebts(reopened);
  const mine = loaded.filter((d) => d.obligationId === "ob-1");

  assert.equal(mine.length, 1, "the debt is in the STORE, not only in the cycle's arguments");
  assert.equal(mine[0].firstFailedAt, debt.firstFailedAt);
  assert.equal(mine[0].consecutiveFailures, 1);
});

test("W3.C: a discharged obligation's debt is CLEARED rather than left to age forever", async () => {
  const repos = createMemoryRepositories();
  const debt = recordFailure(null, {
    obligationId: "ob-1",
    cause: "UPSTREAM_ERROR",
    detail: "500",
    target: "example.invalid",
    dueAt: NOW,
    now: NOW,
  });
  await persistDebts(repos, [debt], NOW);
  const cleared = await persistDebts(repos, [], NOW);

  assert.deepEqual(cleared.cleared, ["ob-1"]);
  const after = await loadDebts(repos);
  assert.equal(after[0].consecutiveFailures, 0, "a tombstone, so the recovery stays replayable");
});

/* ================================================= the http executor ======= */

function response(over: Partial<FetchOutcome> = {}): FetchOutcome {
  return {
    status: 200,
    bytes: 12,
    contentType: "text/html",
    body: "hello world!",
    durationMs: 10,
    transportError: null,
    ...over,
  };
}

test("W3.F: a 200 with bytes becomes INGESTED with a hashed artifact", async () => {
  const run = httpExecutor({
    urlFor: () => "https://example.com/calendar",
    fetchOne: async () => response(),
  });
  const outcome = await run({
    obligation: scheduled(),
    routeTaskId: "rt-abcdefghijkl",
    workItemId: "wi-1",
    attemptId: "at-1",
    executor: "DETERMINISTIC",
    bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 },
    holder: "w",
  });
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(outcome.disposition?.disposition, "INGESTED");
  assert.equal(outcome.artifacts?.length, 1);
  assert.match(String(outcome.artifacts?.[0].contentHash), /^sha256-[0-9a-f]{64}$/);
  assert.equal(outcome.cost?.bytesFetched, 12);
});

test("SEEDED W3.F: a 200 with ZERO BYTES is a failed read, never an empty document", async () => {
  const run = httpExecutor({
    urlFor: () => "https://example.com/calendar",
    fetchOne: async () => response({ bytes: 0, body: "" }),
  });
  const outcome = await run({
    obligation: scheduled(),
    routeTaskId: "rt-abcdefghijkl",
    workItemId: "wi-1",
    attemptId: "at-1",
    executor: "DETERMINISTIC",
    bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 },
    holder: "w",
  });
  assert.equal(outcome.kind, "ABORTED");
  assert.match(outcome.detail, /zero-row extraction is a failed extraction/i);
});

test("SEEDED W3.F: NO status can produce WALKED_NO_YIELD — that is a claim about a government", async () => {
  for (const status of [403, 404, 429, 500, 503]) {
    const run = httpExecutor({
      urlFor: () => "https://example.com/calendar",
      fetchOne: async () => response({ status, body: "", bytes: 0 }),
    });
    const outcome = await run({
      obligation: scheduled(),
      routeTaskId: "rt-abcdefghijkl",
      workItemId: "wi-1",
      attemptId: "at-1",
      executor: "DETERMINISTIC",
      bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 },
      holder: "w",
    });
    assert.notEqual(
      outcome.disposition?.disposition,
      "WALKED_NO_YIELD",
      `HTTP ${status} must never be recorded as the publisher having nothing`,
    );
  }
});
