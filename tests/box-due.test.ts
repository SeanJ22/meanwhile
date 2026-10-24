import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { BOX_DUE_SQL } from "../lib/control-plane/repository/pg-store.ts";

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
