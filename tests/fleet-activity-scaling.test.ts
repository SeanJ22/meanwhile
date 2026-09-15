import assert from "node:assert/strict";
import test from "node:test";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import type { ExecutionLease } from "../lib/control-plane/attempt.ts";
import { projectAutonomousActivity } from "../lib/control-plane/workers/activity.ts";

test("fleet lease attribution preserves ownership and order without rescanning every task for every lease", () => {
  const now = "2026-09-05T18:00:00.000Z";
  const workItems = Array.from({ length: 100 }, (_, i) => createWorkItem({
    project: "fleet-scale", subject: `fixture-${i}`, obligation: "Read a fixture",
    why: "Offline scaling regression", now,
  }));
  let taskIdReads = 0;
  const routeTasks = workItems.flatMap(item => [0, 1].map(i => {
    const task = createRouteTask({ workItemId: item.id, routeId: `route-${i}`,
      routeLabel: "Fixture", target: "https://example.gov/fixture", inherited: false, now });
    return { ...task, get id() { taskIdReads++; return task.id; } };
  }));
  const leases: ExecutionLease[] = routeTasks.map((task, i) => ({
    id: `lease-${i}`, routeTaskId: task.id, holder: "fixture", claimedAt: now,
    expiresAt: now, heartbeatAt: now, released: i % 2 === 0,
  })).reverse();
  leases.push({ ...leases[0], id: "orphan", routeTaskId: "missing-task" });
  taskIdReads = 0;
  const result = projectAutonomousActivity({ workItems, routeTasks, leases,
    attempts: [], transitions: [], dispositions: [], artifacts: [], costs: [],
    scouts: [], workers: [], promotion: [] }, { observedAt: now });
  const readsDuringProjection = taskIdReads;
  assert.equal(result.length, workItems.length);
  for (const activity of result) {
    const owned = new Set(routeTasks.filter(task => task.workItemId === activity.workItem.id).map(task => task.id));
    assert.deepEqual(activity.facts.leases, leases.filter(lease => owned.has(lease.routeTaskId)));
    assert.equal(activity.facts.leases.length, 2, "both released and current leases remain attributed");
  }
  // Count work, not wall-clock time: this fails deterministically on the cubic join.
  assert.ok(readsDuringProjection <= routeTasks.length * 2,
    `Fleet read task IDs ${readsDuringProjection} times for ${routeTasks.length} tasks`);
});
