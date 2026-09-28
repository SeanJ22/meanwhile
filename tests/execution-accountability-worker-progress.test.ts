import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_COST, type Attempt, type ExecutionLease } from "../lib/control-plane/attempt.ts";
import { projectWorkerProgress, readWorkerProgress } from "../lib/control-plane/admin-view/worker-progress.ts";
import type { ControlPlaneRepositories, Persisted } from "../lib/control-plane/repository/types.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const t0 = "2026-09-28T19:00:00.000Z";
const t1 = "2026-09-28T19:01:00.000Z";
const t2 = "2026-09-28T19:02:00.000Z";
const now = "2026-09-28T19:03:00.000Z";
const work = createWorkItem({ project: "normal", subject: "test-body", obligation: "test-obligation", why: "Refresh the body", now: t0 });
const task: RouteTask = { id: "rt-1", workItemId: work.id, attemptIds: ["at-1"], routeId: "route-1",
  routeLabel: "Test route", target: "test-body", inherited: false, state: "PENDING",
  disposition: null, createdAt: t0 };
const worker = { role: "PARSER", provider: "local", version: "v1", instance: "worker-1" } as const;
const attempt: Attempt = { id: "at-1", routeTaskId: task.id, workItemId: work.id, worker,
  leaseId: "lease-1", startedAt: t0, endedAt: t2, outcome: "COMPLETED", abortReason: null,
  artifactIds: [], cost: ZERO_COST, methodVersion: 1, policyVersion: "v1" };
const liveLease: ExecutionLease = { id: "lease-1", routeTaskId: task.id, holder: "worker-1",
  claimedAt: t0, expiresAt: "2026-09-28T19:10:00.000Z", heartbeatAt: t1, released: false };
const result = { id: "wr-1", workItemId: work.id, routeTaskId: task.id, attemptId: attempt.id,
  worker, endedAt: t1, result: { role: "PARSER", verdict: "EXTRACTED" } } as WorkerResultRecord;

test("events are exact durable milestones, ordered and bounded after counting the full item", () => {
  const view = projectWorkerProgress({ work, tasks: [task], attempts: [attempt], leases: [], scouts: [], results: [result] }, now, 2);
  assert.equal(view.totalEvents, 3);
  assert.equal(view.returnedEvents, 2);
  assert.equal(view.hasEarlier, true);
  assert.deepEqual(view.events.map(event => [event.kind, event.outcome]), [
    ["ATTEMPT_ENDED", "COMPLETED"], ["RESULT_RECORDED", "EXTRACTED"],
  ]);
  assert.equal(view.provesPublicDelivery, false);
  assert.equal(JSON.stringify(view).includes("Refresh the body"), false, "no work or worker narrative crosses the read contract");
});

test("an unclosed attempt is active only while its exact lease is live", () => {
  const open = { ...attempt, endedAt: null, outcome: null };
  const active = projectWorkerProgress({ work, tasks: [task], attempts: [open], leases: [liveLease], scouts: [], results: [] }, now);
  assert.equal(active.events[0]?.active, true);
  assert.deepEqual(active.issues, []);
  const stale = projectWorkerProgress({ work, tasks: [task], attempts: [open], leases: [{ ...liveLease, expiresAt: t1 }], scouts: [], results: [] }, now);
  assert.equal(stale.events[0]?.active, false);
  assert.match(stale.issues.join(" "), /no confirmed live lease/);
  const differentClaim = projectWorkerProgress({ work, tasks: [task], attempts: [open], leases: [{ ...liveLease, id: "new-claim" }], scouts: [], results: [] }, now);
  assert.equal(differentClaim.events[0]?.active, false, "a successor lease cannot make an older open attempt live");
});

test("missing linked records remain an explicit gap rather than a zero-progress claim", () => {
  const view = projectWorkerProgress({ work, tasks: [], attempts: [], leases: [], scouts: [], results: [],
    missingTaskIds: [task.id] }, now);
  assert.equal(view.totalEvents, 0);
  assert.match(view.issues.join(" "), /could not be read/);
});

test("foreign and orphan result links never become this work item's progress", () => {
  const foreign = { ...result, id: "wr-foreign", workItemId: "another-work" };
  const orphan = { ...result, id: "wr-orphan", attemptId: "another-attempt" };
  const view = projectWorkerProgress({ work, tasks: [task], attempts: [attempt], leases: [], scouts: [], results: [foreign, orphan] }, now);
  assert.equal(view.totalEvents, 2);
  assert.match(view.issues.join(" "), /no matching attempt/);
});

test("the read path uses point reads and a work-filtered Scout log, never a fleet scan", async () => {
  const row = <T>(id: string, value: T): Persisted<T> => ({ id, value, revision: 1, updatedAt: t0 });
  const calls: string[] = [];
  const read = <T>(name: string, value: T) => async (id: string) => { calls.push(`${name}:${id}`); return row(id, value); };
  const repos = {
    workItems: { read: read("work", { ...work, routeTaskIds: [task.id] }), list: () => { throw new Error("broad work scan"); } },
    routeTasks: { read: read("task", task), list: () => { throw new Error("broad task scan"); } },
    attempts: { read: read("attempt", attempt), list: () => { throw new Error("broad attempt scan"); } },
    leases: { read: read("lease", liveLease) },
    workerResults: { read: async (key: string) => { calls.push(`results:${key}`); return [result]; }, readAll: () => { throw new Error("broad result scan"); } },
    scoutResults: { readWhere: async (key: string, path: readonly string[], value: string) => {
      calls.push(`scouts:${key}:${path.join(".")}:${value}`); return [];
    }, readAll: () => { throw new Error("broad scout scan"); } },
  } as unknown as ControlPlaneRepositories;
  const outcome = await readWorkerProgress(repos, work.id, now);
  assert.equal(outcome.kind, "HELD");
  if (outcome.kind !== "HELD") return;
  assert.equal(outcome.value.totalEvents, 3);
  assert(calls.includes(`scouts:${work.obligation}:workItemId:${work.id}`));
  assert.equal(calls.length, 6);
});
