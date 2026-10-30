import assert from "node:assert/strict";
import test from "node:test";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { requestWorkSooner } from "../lib/db/demand-work.ts";
import { ORGANIC } from "../lib/db/run-marker.ts";
import { factDb } from "./helpers/fact-db.ts";

const BODY = "ocd-division/country:us/state:az/county:pima#board";

async function stores() {
  const db = await factDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Board of Supervisors','AZ')", [BODY]);
  await db.query("INSERT INTO blank(entity_id,field,stage,reason,next_try_at) VALUES($1,'agenda_url','ACQUIRE','missing',now()+interval '3 days')", [BODY]);
  return { db, stores: { work: () => workList(db.query, { owner: "reader-demand" }), blanks: () => db.query } };
}

test("a reader's press puts the subject's hunt in the reader tier and its blanks up for their next pass, and each press moves it up", async t => {
  const { db, stores: held } = await stores();
  t.after(() => db.pg.close());
  assert.equal(await requestWorkSooner({ subjectType: "BODY", subjectId: BODY, ocdIds: ["ocd-division/country:us/state:az"], marker: ORGANIC }, held), true);
  const [row] = await db.query("SELECT kind,tier,status,state,place_id,priority,origin,series FROM work");
  assert.deepEqual(row, { kind: "hunt", tier: "reader", status: "waiting", state: "AZ", place_id: "ocd-division/country:us/state:az/county:pima", priority: 1,
    origin: { from: "demand", subjectType: "BODY", presses: 1 }, series: `blank:${BODY}` });
  const [blank] = await db.query("SELECT reader_requests,next_try_at<=now() AS due FROM blank WHERE entity_id=$1", [BODY]);
  assert.deepEqual(blank, { reader_requests: 1, due: true });

  await requestWorkSooner({ subjectType: "BODY", subjectId: BODY, ocdIds: [], marker: ORGANIC }, held);
  assert.deepEqual(await db.query("SELECT priority,origin->>'presses' AS presses FROM work"), [{ priority: 2, presses: "2" }], "one live row, moved up");
  assert.equal((await db.query("SELECT reader_requests FROM blank"))[0]!.reader_requests, 2);
});

test("a subject that names no place is placed by where the reader was; test traffic writes nothing", async t => {
  const { db, stores: held } = await stores();
  t.after(() => db.pg.close());
  await requestWorkSooner({ subjectType: "CANDIDATE", subjectId: "candidate:jane-doe", ocdIds: ["ocd-division/country:us/state:az/cd:6"], marker: ORGANIC }, held);
  assert.deepEqual(await db.query("SELECT state,place_id,tier FROM work"), [{ state: "AZ", place_id: "ocd-division/country:us/state:az/cd:6", tier: "reader" }]);
  assert.equal(await requestWorkSooner({ subjectType: "BODY", subjectId: BODY, ocdIds: [], marker: { runClass: "SYNTHETIC", runId: "walk" } }, held), false);
  assert.equal((await db.query("SELECT count(*)::int n FROM work"))[0]!.n, 1);
});
