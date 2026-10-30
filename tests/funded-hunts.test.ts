import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workList, type OrderMark } from "../lib/core/work.ts";
import { capabilityLog } from "../lib/core/capability.ts";
import { demoteUnfunded, endedHunts, fundedHunts, fundedMembers } from "../lib/hunt/funded-hunts.ts";
import { FUNDED_LOOK_MS, hunterClaims } from "../lib/control-plane/workers/hunter-claims.ts";
import { dispatchWorkTarget } from "../lib/control-plane/expansion/dispatch-work.ts";
import { assignmentMembership } from "../lib/control-plane/expansion/assignment-budget.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import { workItemHuntDirections } from "../lib/hunt/directions.ts";

const NOW = "2026-10-30T12:00:00.000Z";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const DAY = 86_400_000;

async function open() {
  const pg = new PGlite();
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  return { pg, query, list: workList(query, { owner: "funded-test", now: () => new Date(NOW) }) };
}

const send = (intentId: string, requestedAt = NOW) => dispatchWorkTarget({ intentId, note: "Send agents to Tucson AZ. Fill OFF-17 portraits first.", requestedAt });
const hunts = (target: ReturnType<typeof send>, ended: ReadonlyMap<string, readonly OrderMark[]> = new Map()) =>
  fundedHunts({ targets: [target], divisions: new Map([[target.key, [TUCSON]]]), state: "az", rank: () => null, ended });

test("an Admin order points money at its place: the place's hunt is one paid workers take, carrying the Send, its directions and its budget marks", async t => {
  const { pg, list, query } = await open();
  t.after(() => pg.close());
  const repos = createMemoryRepositories();
  const accepted = await submit({ type: "fleet.deployHere", subject: "fleet", input: { note: "Send agents to Tucson AZ. Fill OFF-17 portraits first.", budgetUsd: 1 },
    stateVersion: null, idempotencyKey: "funded-hunt-check", caller: "OWNER_SESSION", actorRef: "test-owner" },
  { repos, now: () => NOW, currentStateVersion: null, codeSha: null, readPlaceScore: async () => null, wake: null });
  assert.equal(accepted.ok, true, accepted.receipt.says);
  const [intent] = readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).pendingDispatch;
  const target = dispatchWorkTarget({ intentId: intent.intentId, note: intent.note!, requestedAt: intent.requestedAt });

  assert.equal(await list.promote(hunts(target)), 1);
  assert.equal(await list.promote(hunts(target)), 0, "the same Send read again next round writes nothing");
  assert.deepEqual(await query("SELECT kind, tier, series, state, value, origin->>'from' AS origin FROM work"),
    [{ kind: "hunt", tier: "order", series: `blank:${TUCSON}`, state: "AZ", value: { plain: false }, origin: "order" }]);

  let orderedAt: string | null = null;
  const claims = hunterClaims({ list, repos, now: () => NOW, deadEndMs: async () => 5 * DAY, capabilities: capabilityLog(async () => []), deadEndOf: async () => undefined,
    due: async (_government, ordered) => { orderedAt = ordered; return true; }, log: () => {} });
  await claims.select(["az"], false);
  const queue = await claims.claim(true);
  assert.equal(queue?.taskIds.length, 1);
  assert.equal(orderedAt, intent.requestedAt, "the hunters ask whether an order reached the place since its last hunt");
  const [item] = (await repos.workItems.list()).map(row => row.value);
  assert.deepEqual(item!.autonomousPlan?.ownerInstructions, [intent.intentId]);
  assert.equal(item!.autonomousPlan?.assignmentMarks?.[0]?.assignmentKey, target.key, "charges are counted against the Send");
  assert.equal(item!.autonomousPlan?.workKind, "order");
  assert.deepEqual(await workItemHuntDirections(repos, { workItemId: item!.id, governmentId: TUCSON }), [intent.note]);
  const next = await nextAutonomousOperation({ repos, now: () => NOW, methodVersion: 0,
    readEvidence: async () => { throw new Error("No evidence read is needed to schedule the paid hunt"); },
    independentContext: async () => { throw new Error("No audit is needed to schedule the paid hunt"); } }, item!.id);
  assert.equal(next.action, "SCOUT", "the ordered hunt is handed to the hunter");
});

test("a funded place whose blanks are as the last hunt left them waits for its next look", async t => {
  const { pg, list, query } = await open();
  t.after(() => pg.close());
  const repos = createMemoryRepositories();
  await list.promote(hunts(send("i-1")));
  const claims = hunterClaims({ list, repos, now: () => NOW, deadEndMs: async () => 5 * DAY, capabilities: capabilityLog(async () => []), deadEndOf: async () => undefined,
    due: async () => false, log: () => {} });
  await claims.select(["az"], false);
  assert.equal(await claims.claim(true), null);
  assert.deepEqual(await query("SELECT status, repeat_ms::text AS repeat FROM work"), [{ status: "done", repeat: String(FUNDED_LOOK_MS) }]);
  assert.equal((await repos.workItems.list()).length, 0, "nothing was registered for a hunt that was not needed");
});

test("a stop sets its Send aside so the same Send never restarts it, a new Send does, and money that goes away and comes back restores the hunt", async t => {
  const { pg, list } = await open();
  t.after(() => pg.close());
  const first = send("i-1");
  await list.promote(hunts(first));
  const [live] = await list.orderHunts("AZ");
  assert.equal(live!.funded, true);

  // Money gone (a pause, a $0 Send): the hunt is free work again and still knows its Send.
  assert.equal(await demoteUnfunded(list, "az", []), 1);
  const [paused] = await list.orderHunts("AZ");
  assert.deepEqual([paused!.funded, paused!.marks.map(mark => mark.ref), paused!.ended], [false, ["i-1"], []]);
  assert.equal(await demoteUnfunded(list, "az", []), 0, "a hunt already free is not written again");
  assert.equal(await list.promote(hunts(first)), 1, "funded again: the same Send brings the hunt back");
  assert.equal((await list.orderHunts("AZ"))[0]!.funded, true);

  // A stop ends the Send at this place.
  const [stopped] = await list.orderHunts("AZ");
  await list.demote([{ id: stopped!.id, marks: [], ended: stopped!.marks }]);
  const ended = await endedHunts(list, "az");
  assert.deepEqual(hunts(first, ended), [], "the same Send does not restart what it stopped");
  assert.equal(await list.promote(hunts(send("i-3", "2026-10-31T12:00:00.000Z"), ended)), 1, "a new Send does");
  const [again] = await list.orderHunts("AZ");
  assert.deepEqual([again!.funded, again!.marks.map(mark => mark.ref), again!.ended.map(mark => mark.ref)], [true, ["i-3"], ["i-1"]]);

  // The hunts count as the obligations a Send's budget is measured by, whatever their state.
  const members = assignmentMembership(await fundedMembers(list, "az"));
  assert.deepEqual([...members.byKey.keys()].sort(), [first.key, "dispatch:i-3"].sort());
});

test("an order reaching a place a free worker is working sends the hunt back to waiting for paid workers", async t => {
  const { pg, list, query } = await open();
  t.after(() => pg.close());
  await list.ensure([{ kind: "hunt", tier: "coverage", state: "AZ", placeId: TUCSON, subjectId: TUCSON, series: `blank:${TUCSON}`, claimKey: NOW, value: { plain: false, paid: false },
    origin: { from: "planner" }, source: { source: "Open blanks changed" } }]);
  const [held] = await list.claim("hunt", 1, { unpaid: true });
  await list.promote(hunts(send("i-1")));
  assert.equal(await list.finish(held!, DAY), false, "the free worker's finish does not close a hunt that now has paid work to do");
  assert.deepEqual(await query("SELECT status, tier FROM work"), [{ status: "waiting", tier: "order" }]);
  assert.equal((await list.claim("hunt", 1)).length, 1, "paid workers take it");
});
