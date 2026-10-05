/** BR-03: the fix list lives on the control plane: add, survive a reload, complete with before and after, come back. */
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { addFixItem, completeFixItem, fixItems, startFixItem, withFixAdded } from "../lib/control-plane/fix-list.ts";
import { fixQueueView } from "../lib/control-plane/fix-queue.ts";
import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";

const at = "2026-10-05T16:00:00Z";
const deps = (repos = createMemoryRepositories()) => ({ repos, now: () => at, currentStateVersion: null, codeSha: null });
const read = async (repos: ReturnType<typeof createMemoryRepositories>) => (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value as AdminConfig;

test("an item added from code is Open, once, and stays after a fresh read", async () => {
  const repos = createMemoryRepositories();
  const id = await addFixItem(repos, { where: "Workers", says: "A door is shut", by: "The shut-door check", at });
  assert.equal(await addFixItem(repos, { where: "Workers", says: "A door is shut", by: "The shut-door check", at }), id);
  const items = fixItems(await read(repos));
  assert.equal(items.length, 1);
  assert.equal(items[0].state, "OPEN");
  assert.equal(items[0].addedBy, "The shut-door check");
});

test("Add this to the queue and mark done through the gateway; the view shows Open then Fixed and checked with before and after", async () => {
  const repos = createMemoryRepositories();
  const d = deps(repos);
  const add = await submit({ type: "queue.add", subject: "", input: { where: "the control centre", says: "Spend by day is not measured" },
    stateVersion: null, idempotencyKey: "fixlist-add-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(add.ok, true);
  let config = await read(repos);
  let view = v6FixesView(fixQueueView([]), fixItems(config));
  assert.equal(view.open.length, 1);
  assert.equal(view.closed.length, 0);
  const id = fixItems(config)[0].id;
  const done = await submit({ type: "fix.complete", subject: id, input: { id, whatChanged: "Spend is now counted by day", changedBy: "Engineering",
    before: "No daily spend", after: "Daily spend shown" }, stateVersion: null, idempotencyKey: "fixlist-done-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(done.ok, true);
  config = await read(repos);
  view = v6FixesView(fixQueueView([]), fixItems(config));
  assert.equal(view.open.length, 0);
  assert.equal(view.closed.length, 1);
  assert.match(view.closed[0].whatChanged, /Before: No daily spend\. After: Daily spend shown\./);
  const unknown = await submit({ type: "fix.complete", subject: "fix:nope", input: { id: "fix:nope", whatChanged: "x", changedBy: "y", before: "a", after: "b" },
    stateVersion: null, idempotencyKey: "fixlist-done-2", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(unknown.ok, false);
});

test("a fixed item reported again came back; starting moves Open to Being fixed", async () => {
  const repos = createMemoryRepositories();
  const id = await addFixItem(repos, { where: "Pages", says: "Slow page", by: "The speed check", at });
  await startFixItem(repos, id, at);
  assert.equal(fixItems(await read(repos))[0].state, "FIXING");
  await completeFixItem(repos, id, { whatChanged: "c", changedBy: "Engineering", before: "slow", after: "fast" }, at);
  const base = await read(repos);
  const again = withFixAdded(base, { where: "Pages", says: "Slow page", addedBy: "The speed check", at: "2026-10-06T00:00:00Z" });
  assert.equal(fixItems(again)[0].state, "CAME_BACK");
  const view = v6FixesView(fixQueueView([]), fixItems(again));
  assert.equal(view.returned.length, 1);
  assert.equal(view.open.length, 1);
});

test("BR-24: a completed fix is one update on Now with its label and before/after, then gone; Expected is never a win", async () => {
  const { takeUnshownUpdates, addUpdate } = await import("../lib/control-plane/updates.ts");
  const { updatesView, updatesFromChanges } = await import("../lib/control-plane/admin-view/updates-read.ts");
  const repos = createMemoryRepositories();
  const d = deps(repos);
  await submit({ type: "queue.add", subject: "", input: { where: "Pages", says: "Spend by day is not measured" }, stateVersion: null,
    idempotencyKey: "upd-add-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  const id = fixItems(await read(repos))[0].id;
  await submit({ type: "fix.complete", subject: id, input: { id, whatChanged: "Spend is counted by day", changedBy: "Engineering", before: "none", after: "daily" },
    stateVersion: null, idempotencyKey: "upd-done-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  await addUpdate(repos, { id: "soon:1", what: "Door reopening soon", at, label: "EXPECTED" });
  const first = await takeUnshownUpdates(repos, at);
  assert.equal(first.length, 2);
  const view = updatesView(first, at);
  const fixed = view.updates.find((u) => u.what.startsWith("Fixed"))!;
  assert.equal(fixed.label, "Testing");
  assert.equal(fixed.before, "none");
  assert.equal(fixed.isWin, true);
  assert.equal(view.updates.find((u) => u.what.startsWith("Door"))!.isWin, false);
  assert.equal((await takeUnshownUpdates(repos, at)).length, 0, "it leaves Now after one showing");
  const rows = updatesFromChanges([{ number: 1, session: null, line: "Faster pages", status: "live", statusWords: "Live", why: "", url: "u", at }], Date.parse(at));
  assert.equal(rows[0].label, "TESTING");
});

test("BR-15: a scheduled order is saved with its time, shows Scheduled, survives a fresh read and can be unscheduled", async () => {
  const { scheduledView } = await import("../lib/control-plane/admin-view/v6-scheduled-read.ts");
  const repos = createMemoryRepositories();
  const d = deps(repos);
  const bad = await submit({ type: "orders.schedule", subject: "", input: { orderType: "runner.pause", input: {} }, stateVersion: null,
    idempotencyKey: "sched-bad-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(bad.ok, false, "needs a when");
  const ok = await submit({ type: "orders.schedule", subject: "", input: { orderType: "runner.pause", input: {}, startAt: "2026-10-06T12:00:00Z", finishBy: "2026-10-07T12:00:00Z" },
    stateVersion: null, idempotencyKey: "sched-ok-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(ok.ok, true, ok.receipt.says);
  const view = scheduledView(await read(repos), at);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].status, "Scheduled");
  assert.match(view.rows[0].when, /Oct/);
  const id = ok.receipt.subject;
  const gone = await submit({ type: "orders.unschedule", subject: id, input: { id }, stateVersion: null, idempotencyKey: "sched-un-1", caller: "OWNER_SESSION", actorRef: "s" }, d);
  assert.equal(gone.ok, true);
  assert.equal(scheduledView(await read(repos), at).rows.length, 0);
});

test("BR-16/BR-37: due scheduled orders are sent once through the gateway, even if the timer runs twice or restarts", async () => {
  const { fireDueOrders } = await import("../lib/control-plane/gateway/scheduled-fire.ts");
  const repos = createMemoryRepositories();
  const d = deps(repos);
  const sched = (key: string, extra: Record<string, unknown>) => submit({ type: "orders.schedule", subject: "", input: { orderType: "runner.pause", input: {}, ...extra },
    stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "s" }, d);
  const once = await sched("fire-once-1", { startAt: "2026-10-05T17:00:00Z" });
  const later = await sched("fire-later-1", { startAt: "2026-10-06T17:00:00Z" });
  assert.equal(once.ok && later.ok, true);
  assert.deepEqual(await fireDueOrders(d, "2026-10-05T16:30:00Z"), [], "nothing is due yet");
  const first = await fireDueOrders(d, "2026-10-05T17:01:00Z");
  assert.equal(first.length, 1);
  assert.equal(first[0].ok, true);
  assert.deepEqual(await fireDueOrders(d, "2026-10-05T17:02:00Z"), [], "a one-time order is sent once");
  const left = (await read(repos)).scheduledOrders ?? [];
  assert.equal(left.length, 1, "the later one still waits");
  const receipts = await repos.adminReceipts.readAll();
  assert.equal(receipts.filter((r) => r.type === "runner.pause").length, 1);
});
