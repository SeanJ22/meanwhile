import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { routineClockPresence, ROUTINE_CLOCK_PRESENCE_PAGE } from "../lib/civic-data/clock-presence.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";

test("new calendar scopes skip thousands of empty clock proofs; every existing scope keeps its full proof", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_candidates (record_class text, scope text, source_id text, parser_version text);
      CREATE TABLE civic_data_promotions (record_class text, scope text, key text, current_version_id text);
      CREATE TABLE pass_cursor (name text, position text);
      INSERT INTO civic_data_candidates VALUES ('MEETING', 'old-parser', 'old-source', 'old-parser'), ('MEETING', 'refused', 'meetings-public-bodies', 'current');
      INSERT INTO civic_data_promotions VALUES ('MEETING', 'pointer-only','MEETING:pointer-only','accepted'), ('MEETING', 'other-class','MEETING:other-class','complete');
      INSERT INTO pass_cursor VALUES ('meeting-facts:accepted','{"complete":false}'), ('meeting-facts:unaccepted','{"complete":false}'), ('meeting-facts:complete','{"complete":true}');`);
    const tasks: Pick<RoutineSourceTask, "id" | "recordClass" | "scope">[] = [
      ...Array.from({ length: 10_000 }, (_, index) => ({ id: `board-${index}`, recordClass: "MEETING" as const, scope: `unread-board-${index}` })),
      ...["old-parser", "refused", "pointer-only"].map(scope => ({ id: scope, recordClass: "MEETING" as const, scope })),
      { id: "different-class", recordClass: "CURATED_READER_RECORD", scope: "other-class" },
      { id: "same-scope-second-task", recordClass: "MEETING", scope: "refused" },
    ];
    let queries = 0;
    const { absent, pending } = await routineClockPresence(tasks, async (text, params) => {
      queries++;
      assert.ok((params[1] as string[]).length <= ROUTINE_CLOCK_PRESENCE_PAGE);
      return (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    });
    assert.equal(absent.size, 10_001);
    assert.deepEqual([...pending], ["pointer-only"], "only the accepted pointer with unfinished fact publication resumes");
    assert.equal(queries, 22, "twenty-one MEETING pages and one other-class page replace individual empty scope proofs");
    assert.deepEqual(tasks.filter(task => !absent.has(task.id)).map(task => task.id), ["old-parser", "refused", "pointer-only", "same-scope-second-task"]);
    assert.equal(absent.has("different-class"), true, "a pointer of another record class cannot create this task's clock");
    await pg.exec("UPDATE civic_data_promotions SET current_version_id='complete' WHERE scope='pointer-only'");
    const again=await routineClockPresence(tasks,async(text,params)=>(await pg.query<Record<string,unknown>>(text,[...params])).rows);
    assert.deepEqual([...again.pending],[],"the next scheduled pass ignores an unfinished cursor for the replaced version");
    assert.deepEqual(again.absent,absent,"pointer changes keep the same clock scope coverage");
  } finally { await pg.close(); }
});

test("a failed or contradictory presence read cannot classify a scope as empty", async () => {
  const tasks = [{ id: "board", recordClass: "MEETING" as const, scope: "scope" }];
  await assert.rejects(routineClockPresence(tasks, async () => { throw new Error("unreadable"); }), /unreadable/);
  await assert.rejects(routineClockPresence(tasks, async () => [{ scope: "some-other-scope" }]), /PRESENCE_RESPONSE_INVALID/);
  let calls = 0;
  assert.equal((await routineClockPresence([], async () => { calls++; return []; })).absent.size, 0);
  assert.equal(calls, 0);
});
