import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { countHourMigrationDefinition } from "../lib/control-plane/repository/migrations/RB-A8.ts";
import { SHARED_WORK_DDL } from "../lib/control-plane/repository/migrations/RB-A1.ts";
import { workMigrationDefinition } from "../lib/control-plane/repository/migrations/RB-A5.ts";
import { legistarWorkMigrationDefinition } from "../lib/control-plane/repository/migrations/RB-A9.ts";
import { contractWork, expandWork } from "../lib/control-plane/repository/migrations/SPN-01B.ts";
import { REJECT_REWRITE_FUNCTION_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { CONTROL_READS_BACKFILL_DDL } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { JOB_BREAKER_DDL } from "../lib/control-plane/repository/migrations/BB-01.ts";
import { readCounts, readOldest } from "../lib/control-plane/line-keeper/read.ts";
import { countWindow } from "../lib/counts/hour.ts";
import { capabilityLog, installedParsers, reopenDeadEnds } from "../lib/core/capability.ts";
import { workList } from "../lib/core/work.ts";
import { readReopenedItems } from "../lib/control-plane/admin-view/v6-stuck-reopened.ts";

/** The control-plane database as it is in production before the one work list: the old list, its triggers and the hourly counts. */
async function beforeTheOneList() {
  const db = new PGlite();
  await db.exec(JOB_BREAKER_DDL);
  for (const table of ["cp_work_items", "cp_work_items_archive", "cp_doors", "cp_box_findings", "cp_owner_snapshots", "cp_runner_heartbeat"])
    await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),value jsonb NOT NULL)`);
  await db.exec(`CREATE VIEW cp_work_items_history AS SELECT * FROM cp_work_items UNION ALL SELECT * FROM cp_work_items_archive;`);
  await db.exec(CONTROL_READS_BACKFILL_DDL[0]);
  await db.exec(REJECT_REWRITE_FUNCTION_DDL);
  await db.exec(`CREATE TRIGGER cp_owner_snapshots_no_rewrite BEFORE DELETE ON cp_owner_snapshots FOR EACH ROW EXECUTE FUNCTION cp_reject_rewrite();`);
  for (const statement of SHARED_WORK_DDL) await db.exec(statement);
  await db.exec(workMigrationDefinition());
  await db.exec(countHourMigrationDefinition());
  await db.exec(legistarWorkMigrationDefinition());
  return db;
}
const rows = (db: PGlite) => async (text: string, params: readonly unknown[] = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows;
const sql = (db: PGlite) => ({ query: rows(db) });
const stock = async (db: PGlite) => {
  const window = countWindow(new Date(Date.now() + 3_600_000).toISOString());
  const totals = new Map<string, number>();
  for (const row of await readCounts(sql(db), window.from, window.through, window.through))
    if (row.stage.startsWith("work list:")) totals.set(`${row.state}/${row.family}/${row.stage}`, (totals.get(`${row.state}/${row.family}/${row.stage}`) ?? 0) + row.total);
  return [...totals].filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b));
};

test("the old list's rows move across, are counted once, and the old list can go without a gap", async t => {
  const db = await beforeTheOneList();
  t.after(() => db.close());
  const query = rows(db);
  const past = new Date(Date.now() - 2 * 3_600_000).toISOString(), future = new Date(Date.now() + 12 * 3_600_000).toISOString();
  await db.query(`INSERT INTO work_row(id,kind,state,place_id,subject_id,url,not_before,value,reports,priority) VALUES
    ('check-a','check','AZ','place','legistar-members:pima',NULL,$1::timestamptz,'{"x":1}','[{"source":"Legistar members"}]',20),
    ('check-b','check','AZ','place','legistar-members:pima',NULL,$1::timestamptz,'{"x":2}','[]',10),
    ('check-done','check','AZ','place','legistar-members:pima',NULL,$1::timestamptz,'{"x":3}','[]',10),
    ('check-refused','check','NY','place','legistar-members:erie',NULL,$1::timestamptz,'{"x":4}','[]',10),
    ('load-1','load','AZ','place','legistar-members:pima','https://webapi.legistar.com/v1/pima/officerecords',$2::timestamptz,'null','[]',0),
    ('detect-1','detect','US','place','legistar-members:erie',NULL,$1::timestamptz,'null','[]',0)`, [past, future]);
  await db.query(`UPDATE work_row SET status='done',done_times=ARRAY[now()] WHERE id='check-done'`);
  await db.query(`UPDATE work_row SET status='refused',refusal='gone',refused_times=ARRAY[now()] WHERE id='check-refused'`);
  await db.query(`UPDATE work_row SET status='taken',lease_owner='old-worker',lease_until=now()+interval '5 minutes' WHERE id='check-b'`);
  const before = await stock(db);
  assert.ok(before.length > 0);

  await expandWork(sql(db));
  const moved = await query("SELECT id,kind,tier,status,state,priority,series,lease_owner,origin->>'from' AS origin FROM work ORDER BY id");
  assert.deepEqual(moved, [
    { id: "check-a", kind: "check", tier: "coverage", status: "waiting", state: "AZ", priority: 20, series: null, lease_owner: null, origin: "loader" },
    { id: "check-b", kind: "check", tier: "coverage", status: "waiting", state: "AZ", priority: 10, series: null, lease_owner: null, origin: "loader" },
    { id: "check-done", kind: "check", tier: "coverage", status: "done", state: "AZ", priority: 10, series: null, lease_owner: null, origin: "loader" },
    { id: "check-refused", kind: "check", tier: "coverage", status: "refused", state: "NY", priority: 10, series: null, lease_owner: null, origin: "loader" },
    { id: "detect-1", kind: "detect", tier: "coverage", status: "waiting", state: "US", priority: 0, series: null, lease_owner: null, origin: "detective" },
    { id: "load-1", kind: "load", tier: "clock", status: "waiting", state: "AZ", priority: 0, series: "load-1", lease_owner: null, origin: "loader" },
  ]);
  assert.deepEqual(await query("SELECT kind,tier,n::int AS n FROM work_waiting WHERE n<>0 ORDER BY kind,tier"),
    [{ kind: "check", tier: "coverage", n: 2 }, { kind: "detect", tier: "coverage", n: 1 }, { kind: "load", tier: "clock", n: 1 }]);
  const afterCopy = await stock(db);
  const unleased = (counts: typeof before) => counts.filter(([key]) => !/LEASED|EXPIRED/.test(key));
  assert.deepEqual(unleased(afterCopy), unleased(before).map(([key, n]) => key === "AZ/check/work list:WAITING" ? [key, n + 1] as [string, number] : [key, n] as [string, number]),
    "each row is counted once: the copy neither doubles the stock nor loses it, and the leased row is simply waiting again");
  const hourly = await query("SELECT step,sum(n)::int AS n FROM count_hour WHERE step IN ('work_in','work_done','work_refused') GROUP BY step ORDER BY step");
  assert.deepEqual(hourly, [{ step: "work_done", n: 1 }, { step: "work_in", n: 6 }, { step: "work_refused", n: 1 }], "history is not counted a second time");

  // The code still running on the old list is not stopped: its writes land, and the new list is not disturbed by them.
  await db.query(`INSERT INTO work_row(id,kind,state,place_id,subject_id) VALUES('old-code','check','AZ','place','legistar-members:pima')`);
  await db.query(`UPDATE work_row SET status='taken',lease_owner='old-worker',lease_until=now()+interval '5 minutes' WHERE id='old-code'`);
  assert.equal((await query("SELECT count(*)::int n FROM work WHERE id='old-code'"))[0]!.n, 0);
  assert.deepEqual((await stock(db)).filter(([key]) => key.includes("LEASED")), afterCopy.filter(([key]) => key.includes("LEASED")));

  // The piles the line keeper ages now come from the new list.
  const oldest = await readOldest(sql(db), new Date(Date.now() + 60_000).toISOString());
  assert.deepEqual(oldest.filter(row => row.family === "check").map(row => [row.state, row.stage, row.count]).sort(), [["AZ", "work list:WAITING", 2], ["NY", "work list:REFUSED", 1]]);

  // New code claims from the new list in order.
  const list = workList(query, { owner: "new-code" });
  const [first] = await list.claim("check", 1, "legistar-members:");
  assert.equal(first!.id, "check-a", "priority orders the claim within the tier");
  assert.equal(await list.finish(first!), true);

  await contractWork(sql(db));
  assert.equal((await query("SELECT to_regclass('work_row') AS gone"))[0]!.gone, null);
  assert.deepEqual((await stock(db)).filter(([key]) => !key.includes("LEASED")).length > 0, true);
  const [second] = await list.claim("check", 1);
  assert.equal(second!.id, "check-b");
  assert.equal(await list.finish(second!), true);
  assert.equal((await query("SELECT count(*)::int n FROM work WHERE status='done'"))[0]!.n, 3);
});

test("a refused Legistar record from production is a dead end after the move, and the next Legistar reader puts it back on the list and Admin says so", async t => {
  const db = await beforeTheOneList();
  t.after(() => db.close());
  const query = rows(db);
  // The shape of a real refused row in production (Olympia, member 683), refused on October 29.
  await db.query(`INSERT INTO work_row(id,kind,state,place_id,subject_id,field,url,priority,attempts,received_at,value,reports,refusal,status,refused_times)
    VALUES('work-9dc32a2347901b642612a527ad2498d6c88180c746d8f5f4f4170a148987a0e5','check','US','ocd-division/country:us','legistar-members:olympia','member:683',
    'https://webapi.legistar.com/v1/olympia/officerecords',20,1,'2026-10-29T06:52:45Z','{"slug":"olympia","type":"member","reason":"The source record has no unambiguous government binding"}',
    '[{"url":"https://webapi.legistar.com/v1/olympia/officerecords","source":"Legistar members","placeId":"ocd-division/country:us","subjectId":"legistar-members:olympia"}]',
    'The source record has no unambiguous government binding','refused',ARRAY['2026-10-29T07:26:07Z'::timestamptz])`);
  await expandWork(sql(db));
  const [dead] = await query("SELECT status, unlock, dead_since FROM work");
  assert.deepEqual([dead!.status, dead!.unlock, new Date(dead!.dead_since as string).toISOString()], ["refused",
    { kind: "parser", name: "legistar", platform: "legistar", text: "The source record has no unambiguous government binding" }, "2026-10-29T07:26:07.000Z"]);

  // The first lane after the release announces the readers it has; the one for Legistar is newer than the dead end.
  const log = capabilityLog(query), now = "2026-10-30T01:00:00.000Z";
  await log.record(await installedParsers(), now);
  assert.equal(await reopenDeadEnds(workList(query, { owner: "lane", now: () => new Date(now) }), log, 5 * 86_400_000, now), 1);
  const [back] = await query("SELECT status, tier, refusal FROM work");
  assert.deepEqual(back, { status: "waiting", tier: "coverage", refusal: null });
  const [item] = await readReopenedItems(query, "2026-10-30T02:00:00.000Z");
  assert.equal(item!.cause, "Reopened — unlocked by a new reader for legistar");
  assert.equal(item!.title, "A dead end came back: The source record has no unambiguous government binding");
  assert.equal(item!.next, "Back on the work list, waiting its turn.");
  assert.equal(item!.tried, "It was waiting for a reader for legistar.");
});
