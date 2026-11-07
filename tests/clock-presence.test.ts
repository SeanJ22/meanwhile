import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { routineTasksWithoutClocks, ROUTINE_CLOCK_PRESENCE_PAGE } from "../lib/civic-data/clock-presence.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";

test("new calendar scopes skip thousands of empty clock proofs; every existing scope keeps its full proof", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_candidates (record_class text, scope text, source_id text, parser_version text);
      CREATE TABLE civic_data_promotions (record_class text, scope text);
      INSERT INTO civic_data_candidates VALUES ('MEETING', 'old-parser', 'old-source', 'old-parser'), ('MEETING', 'refused', 'meetings-public-bodies', 'current');
      INSERT INTO civic_data_promotions VALUES ('MEETING', 'pointer-only'), ('MEETING', 'other-class');`);
    const tasks: Pick<RoutineSourceTask, "id" | "recordClass" | "scope">[] = [
      ...Array.from({ length: 10_000 }, (_, index) => ({ id: `board-${index}`, recordClass: "MEETING" as const, scope: `unread-board-${index}` })),
      ...["old-parser", "refused", "pointer-only"].map(scope => ({ id: scope, recordClass: "MEETING" as const, scope })),
      { id: "different-class", recordClass: "CURATED_READER_RECORD", scope: "other-class" },
      { id: "same-scope-second-task", recordClass: "MEETING", scope: "refused" },
    ];
    let queries = 0;
    const absent = await routineTasksWithoutClocks(tasks, async (text, params) => {
      queries++;
      assert.ok((params[1] as string[]).length <= ROUTINE_CLOCK_PRESENCE_PAGE);
      return (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    });
    assert.equal(absent.size, 10_001);
    assert.equal(queries, 22, "twenty-one MEETING pages and one other-class page replace individual empty scope proofs");
    assert.deepEqual(tasks.filter(task => !absent.has(task.id)).map(task => task.id), ["old-parser", "refused", "pointer-only", "same-scope-second-task"]);
    assert.equal(absent.has("different-class"), true, "a pointer of another record class cannot create this task's clock");
  } finally { await pg.close(); }
});

test("a failed or contradictory presence read cannot classify a scope as empty", async () => {
  const tasks = [{ id: "board", recordClass: "MEETING" as const, scope: "scope" }];
  await assert.rejects(routineTasksWithoutClocks(tasks, async () => { throw new Error("unreadable"); }), /unreadable/);
  await assert.rejects(routineTasksWithoutClocks(tasks, async () => [{ scope: "some-other-scope" }]), /PRESENCE_RESPONSE_INVALID/);
  let calls = 0;
  assert.equal((await routineTasksWithoutClocks([], async () => { calls++; return []; })).size, 0);
  assert.equal(calls, 0);
});
