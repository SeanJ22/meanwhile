import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { BOX_DUE_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { BOX_DUE_INDEXES } from "../lib/control-plane/repository/pg-schema.ts";

test("the server's Box query alternates old and never-read findings, drains both, and respects each failed finding's retry", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE cp_box_findings (id text PRIMARY KEY, value jsonb NOT NULL)");
  const now = "2026-10-22T22:00:00.000Z", later = "2026-10-22T22:05:00.000Z";
  const put = (id: string, value: unknown) => pg.query("INSERT INTO cp_box_findings VALUES ($1, $2)", [id, value]);
  for (let n = 0; n < 12; n++) {
    await put(`old-${String(n).padStart(2, "0")}`, { state: "waiting", waitingFor: { slots: "7" } });
    await put(`new-${String(n).padStart(2, "0")}`, { state: "waiting" });
  }
  await put("a-retry", { state: "waiting", waitingFor: { slots: "current", retryAt: later } });
  await put("b-source-recovered", { state: "refused", attempts: [{ builder: "fact-publisher" }], waitingFor: { slots: "current", retryAt: later } });
  const read = async (at: string) => (await pg.query<{ id: string; value: { waitingFor?: { slots: string } } }>(BOX_DUE_SQL, [JSON.stringify({ other: "current" }), at, 6])).rows;
  const first = await read(now);
  assert.deepEqual(first.map(row => row.id), ["old-00", "new-00", "old-01", "new-01", "old-02", "new-02"]);
  for (const row of first) await pg.query("UPDATE cp_box_findings SET value = jsonb_build_object('state', 'waiting', 'waitingFor', jsonb_build_object('slots', 'current')) WHERE id = $1", [row.id]);
  const second = await read(now);
  assert.deepEqual(second.map(row => row.id), ["old-03", "new-03", "old-04", "new-04", "old-05", "new-05"]);
  assert.equal((await read(later))[0]!.id, "a-retry", "the failed row comes back on its own clock without rewinding either backlog");
  assert.equal((await read(later))[2]!.id, "b-source-recovered", "a refused source read can recover without a release");
});

test("stale slots are found per class, and every branch of the Box query reads from an index instead of walking the Box", async t => {
  // Oct 24 4 PM to 11:44 PM EDT: boxDue read about 610,000 pages a call to find 1,600 due rows and ran past its 25 s bound on 13 passes.
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE cp_box_findings (id text PRIMARY KEY, value jsonb NOT NULL)");
  for (const index of BOX_DUE_INDEXES) await pg.exec(index.ddl.replace(" CONCURRENTLY", ""));
  const now = "2026-10-25T04:30:00.000Z";
  const put = (id: string, value: unknown) => pg.query("INSERT INTO cp_box_findings VALUES ($1, $2)", [id, value]);
  for (let n = 0; n < 300; n++) await put(`walk-${String(n).padStart(3, "0")}`, { state: "waiting", waitingFor: { class: "site walk", slots: "416c9cc838906e94" } });
  await put("rosters-current", { state: "waiting", waitingFor: { class: "rosters", slots: "3" } });
  await put("rosters-old", { state: "waiting", waitingFor: { class: "rosters", slots: "2" } });
  await put("seat-old", { state: "waiting", refusal: "SEAT_NOT_IN_QUOTE", waitingFor: { class: "other", slots: "2" } });
  await put("unknown-class", { state: "waiting", waitingFor: { class: "detective", slots: "1" } });
  await put("no-class", { state: "waiting", waitingFor: { slots: "1" } });
  await put("retry-later", { state: "waiting", waitingFor: { class: "contacts", slots: "1", retryAt: "2026-10-25T05:00:00.000Z" } });
  await put("retry-now", { state: "waiting", waitingFor: { class: "contacts", slots: "1", retryAt: "2026-10-25T04:00:00.000Z" } });
  const due = async (slots: Record<string, number>) => (await pg.query<{ id: string }>(BOX_DUE_SQL, [JSON.stringify(slots), now, 1000])).rows.map(row => row.id).sort();
  const slots = { rosters: 3, contacts: 1, "site walk": 1, other: 1 };
  assert.deepEqual(await due(slots), ["retry-now", "rosters-old", "seat-old"]);
  assert.deepEqual(await due({ ...slots, other: 2 }), ["no-class", "retry-now", "rosters-old", "seat-old", "unknown-class"], "classes without their own slot follow other");
  assert.equal((await due({ ...slots, "site walk": 2 })).filter(id => id.startsWith("walk-")).length, 300, "a moved publisher slot requeues its whole class");

  await pg.exec("SET enable_seqscan = off");
  const plan = (await pg.query<{ "QUERY PLAN": string }>(`EXPLAIN ${BOX_DUE_SQL}`, [JSON.stringify(slots), now, 1000])).rows.map(row => row["QUERY PLAN"]).join("\n");
  assert.doesNotMatch(plan, /Seq Scan/, plan);
  for (const index of BOX_DUE_INDEXES.filter(index => index.name !== "cp_box_findings_unslotted")) assert.match(plan, new RegExp(index.name), plan);
});
