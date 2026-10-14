import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { beginAttempt, type ExecutionLease } from "../lib/control-plane/attempt.ts";
import type { ScoutedRecord } from "../lib/control-plane/promotion/types.ts";
import { projectAutonomousActivity } from "../lib/control-plane/workers/activity.ts";

test("fleet lease attribution preserves ownership and order without rescanning every task for every lease", () => {
  const now = "2026-09-05T18:00:00.000Z";
  const workItems = Array.from({ length: 100 }, (_, i) => createWorkItem({
    project: "fleet-scale", subject: `fixture-${i}`, obligation: "Read a fixture",
    why: "Offline scaling regression", now,
  }));
  let taskIdReads = 0, taskOwnerReads = 0, attemptIdReads = 0;
  const routeTasks = workItems.flatMap(item => [0, 1].map(i => {
    const task = createRouteTask({ workItemId: item.id, routeId: `route-${i}`,
      routeLabel: "Fixture", target: "https://example.gov/fixture", inherited: false, now });
    return { ...task, get id() { taskIdReads++; return task.id; },
      get workItemId() { taskOwnerReads++; return task.workItemId; } };
  }));
  const leases: ExecutionLease[] = routeTasks.map((task, i) => ({
    id: `lease-${i}`, routeTaskId: task.id, holder: "fixture", claimedAt: now,
    expiresAt: now, heartbeatAt: now, released: i % 2 === 0,
  })).reverse();
  leases.push({ ...leases[0], id: "orphan", routeTaskId: "missing-task" });
  const attempts = routeTasks.map((task, i) => {
    const attempt = beginAttempt({ routeTaskId: task.id, workItemId: task.workItemId,
      worker: { role: "SCOUT", provider: "fixture", version: "fixture", instance: `fixture-${i}` },
      lease: leases.find(lease => lease.routeTaskId === task.id)!, now, methodVersion: 1, policyVersion: "fixture" });
    return { ...attempt, get id() { attemptIdReads++; return attempt.id; } };
  });
  const promotion: ScoutedRecord[] = attempts.map((attempt, i): ScoutedRecord => ({
    formatVersion: 1, recordId: `scouted-${i}`, itemId: `pipeline-${i}`, at: now,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: `fixture-${i}` }, stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: attempt.id, obligationId: `ob-${i}`, outcome: "ROUTE_CANDIDATE", routeId: null },
    recordClass: "meetings", subjectId: `fixture-${i}`, canonicalUrl: null,
    artifactIds: [], scoutAttemptId: attempt.id, summary: "Fixture route",
  })).reverse();
  // Even an identical repeated record retains its exact position among peers.
  promotion.push(promotion[0]);
  taskIdReads = 0;
  taskOwnerReads = 0;
  attemptIdReads = 0;
  const result = projectAutonomousActivity({ workItems, routeTasks, leases,
    attempts, transitions: [], dispositions: [], artifacts: [], costs: [],
    scouts: [], workers: [], promotion }, { observedAt: now });
  const readsDuringProjection = taskIdReads;
  const ownersDuringProjection = taskOwnerReads, attemptsDuringProjection = attemptIdReads;
  assert.equal(result.length, workItems.length);
  for (const activity of result) {
    const owned = new Set(routeTasks.filter(task => task.workItemId === activity.workItem.id).map(task => task.id));
    assert.deepEqual(activity.facts.leases, leases.filter(lease => owned.has(lease.routeTaskId)));
    assert.equal(activity.facts.leases.length, 2, "both released and current leases remain attributed");
    const ownedAttempts = new Set(attempts.filter(attempt => attempt.workItemId === activity.workItem.id).map(attempt => attempt.id));
    assert.deepEqual(activity.facts.promotion, promotion.filter(record => record.source.kind !== "PROMOTED_CANDIDACY" && ownedAttempts.has(record.source.attemptId)),
      "pipeline attribution retains original order and duplicate records");
  }
  // Count work, not wall-clock time: this fails deterministically on the cubic join.
  assert.ok(readsDuringProjection <= routeTasks.length * 2,
    `Fleet read task IDs ${readsDuringProjection} times for ${routeTasks.length} tasks`);
  assert.ok(ownersDuringProjection <= routeTasks.length * 2,
    `Fleet rescanned ${ownersDuringProjection} task owners for ${routeTasks.length} tasks`);
  assert.ok(attemptsDuringProjection <= attempts.length * 10,
    `Fleet rescanned ${attemptsDuringProjection} Attempt IDs for ${attempts.length} Attempts and ${promotion.length} promotion records`);
});
