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
