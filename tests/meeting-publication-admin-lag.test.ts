import assert from "node:assert/strict";
import { test } from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import {
  projectRoutineDataObservability,
  type RoutineMeetingQueueRow,
  type RoutineObservabilityRows,
} from "../lib/civic-data/observability.ts";

const NOW = "2026-09-15T12:00:00.000Z";
const C0 = MEETING_PARTITION_CONTRACTS[0]!;
const C1 = MEETING_PARTITION_CONTRACTS[1]!;

const queued = (scope: string, queuedAt: string): RoutineMeetingQueueRow => ({ scope, queuedAt });

function rows(overrides: Partial<RoutineObservabilityRows>): RoutineObservabilityRows {
  return { candidates: [], events: [], promotions: [], ...overrides };
}

const publication = (meetingQueue?: readonly RoutineMeetingQueueRow[]) =>
  projectRoutineDataObservability(rows(meetingQueue === undefined ? {} : { meetingQueue }), NOW, [C0]).meetingPublication;

test("admin lag: an empty queue means every promoted version and check reached the readers, a measured zero", () => {
  const view = publication([]);
  assert.equal(view.waiting.kind, "MEASURED");
  assert.equal(view.waiting.kind === "MEASURED" && view.waiting.value, 0);
  assert.equal(view.oldestQueuedAt.kind, "NOT_RECORDED", "with nothing waiting there is no oldest instant to invent");
  assert.match(view.detail, /Every promoted meeting version and check has reached the readers' records/);
});

test("admin lag: queued partitions are exact publication lag, oldest first, with the wait in minutes", () => {
  const view = publication([
    queued(C1.scope, "2026-09-15T11:50:00.000Z"),
    queued(C0.scope, "2026-09-15T11:30:00.000Z"),
  ]);
  assert.equal(view.waiting.kind, "MEASURED");
  if (view.waiting.kind !== "MEASURED" || !("members" in view.waiting)) return;
  assert.equal(view.waiting.value, 2);
  assert.deepEqual(view.waiting.members.map((m) => m.scope), [C0.scope, C1.scope], "the longest-waiting partition is named first");
  assert.deepEqual(view.oldestQueuedAt, { kind: "MEASURED", value: "2026-09-15T11:30:00.000Z" });
  assert.match(view.detail, /2 meeting partition\(s\) are waiting/);
  assert.match(view.detail, /oldest has waited 30 min/);
});

test("admin lag: a queue instant the database sends as text is read as an instant", () => {
  const view = publication([queued(C0.scope, "2026-09-15 11:45:00+00")]);
  assert.equal(view.oldestQueuedAt.kind === "MEASURED" && view.oldestQueuedAt.value, "2026-09-15T11:45:00.000Z");
  assert.match(view.detail, /oldest has waited 15 min/);
});

test("admin lag: a queue that was not read is not-recorded, never a zero wait", () => {
  const view = publication();
  assert.equal(view.waiting.kind, "NOT_RECORDED");
  assert.equal(view.oldestQueuedAt.kind, "NOT_RECORDED");
  assert.match(view.detail, /was not read/);
});
