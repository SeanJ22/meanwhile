/**
 * The fix view states only what the fix queue holds. Waiting and refused
 * items need attention; sent and opened ones are being fixed; no fixed history
 * is invented.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import type { FixQueueItem, FixQueueView } from "../lib/control-plane/fix-queue.ts";

const item = (state: FixQueueItem["state"], over: Partial<FixQueueItem> = {}): FixQueueItem => ({
  subjectId: `fix:${state}`,
  intentId: `i-${state}`,
  where: "Money",
  says: "Cost per record is not measured yet. It needs every charge to say what it was for.",
  queuedAt: "2026-09-30T20:00:00.000Z",
  state,
  openedWork: [],
  refusedReason: null,
  ...over,
});
const queue = (items: readonly FixQueueItem[]): FixQueueView => ({
  items,
  lastGo: null,
  counts: { queued: 0, sent: 0, opened: 0, refused: 0 },
});

test("queued and refused items need attention; sent and opened ones are being fixed", () => {
  const view = v6FixesView(queue([item("QUEUED"), item("REFUSED", { refusedReason: "a gate refused it" }), item("SENT"), item("OPENED", { openedWork: [{ id: "W-1", title: "Cost per record" }] })]));
  assert.deepEqual(view.open.map((o) => o.tab), ["attention", "attention", "fixing", "fixing"]);
  const opened = view.open[3];
  assert.equal(opened.taskId, "W-1");
  assert.equal(opened.taskStage, 0);
  assert.match(view.open[1].placeInLine, /a gate refused it/);
  assert.equal(view.open[0].title, "Cost per record is not measured yet.");
});

test("no fixed history is invented: closed and returned stay empty", () => {
  const view = v6FixesView(queue([item("OPENED")]));
  assert.deepEqual([view.closed.length, view.returned.length], [0, 0]);
});
