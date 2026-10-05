/**
 * BR-14: the Queue lists every order, scheduled order, send, hunt, stuck case, shut door and fix item exactly once, under the
 * right filter, each with the control that stops or pauses it. A section that was not read adds nothing and is not a zero.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildQueue, queueCounts, type QueueInput } from "../app/(admin)/_mw/admin-v6/queue.ts";
import type { FixView, Hunt, OpenFix, SentInstruction, StuckItem, UiReceipt } from "../app/(admin)/_mw/admin-v6/model.ts";

const lifecycle = { saved: "2026-10-05T10:00:00Z", workersReceived: null, workStarted: null, workFinished: null, factsChecked: null, published: null, checkedOnPublicPage: null };
const receipt = (over: Partial<UiReceipt>): UiReceipt => ({
  key: "r1", kind: "global-ceiling", target: "us", targetName: "the daily budget", label: "Set the daily budget", scopeKey: "us", scopeName: "United States", level: "global",
  status: "done", statusWords: "Done", steps: [], says: "Saved.", items: [], lifecycle, simulated: false, gatewayType: null, gatewayReceiptId: null, readBackAt: null, replayed: false, sentAt: "2026-10-05T10:00:00Z", ...over,
});
const hunt = (over: Partial<Hunt>): Hunt => ({ id: "h1", placeKey: "geo:xx.zcta.00001", name: "Place A", startedAt: "2026-10-05T09:00:00Z", limitUsd: 10, limitSource: "hunt", spentUsd: 2.5, heldUsd: 0, unpricedEntries: 0, status: "running", researchWorkers: 1, ...over });
const stuck = (over: Partial<StuckItem>): StuckItem => ({ id: "s1", title: "A source is blocked", applies: [], lane: "decision", cause: "c", age: "1d", ageRank: 1, tried: "", helped: "", next: "Decide.", owner: "You", actions: [{ kind: "decide", target: "s1" }], ...over });
const send = (over: Partial<SentInstruction>): SentInstruction => ({ id: "i1", words: "Fill the school board", sentAt: "2026-10-05T10:00:01Z", state: "carried", stateWords: "4 left to create", ranAs: null, canCancel: true, ...over });
const openFix = (over: Partial<OpenFix>): OpenFix => ({ id: "f1", title: "Repair the reader", tab: "attention", owner: "Engineering", problem: "It breaks.", helps: "", placeInLine: "1", resourcesNow: "", taskStage: 2, taskId: "T-1", linkedStuck: [], origin: "engineering", technical: "", ...over });

const input = (over: Partial<QueueInput> = {}): QueueInput => ({
  receipts: null, sends: null, hunts: null, stuck: null, fixes: null, doors: null, scheduled: null, ...over,
});

test("each kind of thing appears once, under the right filter, with its own stop or pause", () => {
  const fixes: FixView = { open: [openFix({}), openFix({ id: "f2", tab: "fixing" })], closed: [], returned: [] };
  const rows = buildQueue(input({
    receipts: [receipt({}), receipt({ key: "r2", status: "refused", statusWords: "Refused" }), receipt({ key: "r3", status: "running", statusWords: "Running" })],
    hunts: [hunt({}), hunt({ id: "h2", placeKey: "geo:xx.zcta.00002", status: "paused" })],
    stuck: [stuck({}), stuck({ id: "s2", lane: "auto" })],
    doors: [{ name: "A school board agenda page", why: "Its page changed.", since: "2026-10-04T00:00:00Z" }],
    scheduled: [{ id: "sch-1", label: "Pause paid work at night", when: "Oct 6, 9:00 PM ET", repeats: "Repeats every day", finishBy: null }],
    sends: [send({})],
    fixes,
  }));
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "no row appears twice");
  assert.equal(rows.length, 3 + 2 + 2 + 1 + 1 + 1 + 2);
  const by = (key: string) => rows.find((r) => r.key === key)!;
  assert.equal(by("order:r1").filter, "done");
  assert.equal(by("order:r2").filter, "needs-me");
  assert.equal(by("order:r3").filter, "in-progress");
  assert.equal(by("hunt:h1").filter, "in-progress");
  assert.deepEqual(by("hunt:h1").actions.map((a) => a.kind), ["hunt-pause", "hunt-stop"]);
  assert.deepEqual(by("hunt:h2").actions.map((a) => a.kind), ["hunt-resume", "hunt-stop"]);
  assert.equal(by("stuck:s1").filter, "needs-me");
  assert.equal(by("stuck:s2").filter, "in-progress");
  assert.equal(by("scheduled:sch-1").filter, "scheduled");
  assert.deepEqual(by("scheduled:sch-1").actions, [{ kind: "order-unschedule", target: "sch-1", label: "Cancel this scheduled order" }]);
  assert.deepEqual(by("send:i1").actions.map((a) => a.kind), ["cancel-send"]);
  assert.equal(by("fix:f1").filter, "needs-me");
  assert.equal(by("fix:f2").filter, "in-progress");
  assert.equal(by("fix:f1").progress?.of, 7);
  assert.equal(queueCounts(rows)["needs-me"], 3);
});

test("a send listed with its saved order is one row, and an unmatched saved order stays", () => {
  const rows = buildQueue(input({
    receipts: [receipt({ key: "r9", kind: "send-agents", words: "Fill the school  board", status: "queued", statusWords: "Saved" }), receipt({ key: "r10", kind: "send-agents", words: "Something older", sentAt: "2026-09-01T00:00:00Z" })],
    sends: [send({})],
  }));
  assert.deepEqual(rows.map((r) => r.key).sort(), ["order:r10", "send:i1"]);
});

test("a section that could not be read adds no rows, and a stopped hunt has no stop control", () => {
  assert.deepEqual(buildQueue(input()), []);
  const rows = buildQueue(input({ hunts: [hunt({ status: "stopped" })] }));
  assert.equal(rows[0].filter, "done");
  assert.deepEqual(rows[0].actions, []);
  assert.equal(rows[0].progress?.of, 10);
});
