import assert from "node:assert/strict";
import test from "node:test";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { sliceTurn } from "../lib/reader/slice-lane.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const place = (n: number) => `ocd-division/country:us/state:az/place:p${String(n).padStart(3, "0")}`;
const POISON = place(7);

async function open(count: number) {
  const db = await migratedFactDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  await db.query("INSERT INTO entity(id,kind,name,state) SELECT 'ocd-division/country:us/state:az/place:p'||lpad(n::text,3,'0'),'place','P','AZ' FROM generate_series(1,$1::int) n", [count]);
  const mark = (ids: readonly string[]) => workList(db.query, { owner: "mark" }).touch(ids.map(id => ({ kind: "slice" as const, placeId: id, subjectId: id, field: "governs", origin: { from: "loader" as const }, source: { source: "test" } })));
  return { db, mark };
}

test("one subject that cannot be built does not hold back the other nineteen, and its failure is named", async () => {
  const { db, mark } = await open(20);
  try {
    // Reading the poisoned place's entities fails, as a statewide place's read timing out would.
    const facts: typeof db.query = async (text, params = []) => {
      if (text.includes("FROM entity_place ep JOIN entity e") && (params[0] as string[]).includes(POISON)) throw new Error("Query read timeout");
      return db.query(text, params);
    };
    await mark(Array.from({ length: 20 }, (_, i) => place(i + 1)));
    const lines: string[] = [], list = workList(db.query, { owner: "lane" });
    const turn = await sliceTurn({ list, facts, log: line => lines.push(line) });
    assert.equal(turn.claimed, 20);
    const rows = await db.query("SELECT subject_id,status,refusal FROM work WHERE kind='slice' ORDER BY subject_id");
    assert.equal(rows.filter(row => row.status === "done").length, 19, "the other nineteen are finished");
    assert.deepEqual(rows.filter(row => row.status !== "done").map(row => [row.subject_id, row.status, row.refusal]), [[POISON, "waiting", "Query read timeout"]]);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes(POISON) && lines[0]!.includes("Query read timeout"), "the turn line names the subject and the reason");
    assert.equal((await db.query("SELECT due_at > now() AS later FROM work WHERE subject_id=$1", [POISON]))[0]!.later, true, "a failed subject waits before its next try");
  } finally { await db.pg.close(); }
});

test("with a whole batch of marks always waiting, every other look gives places their first slices", async () => {
  const { db, mark } = await open(150);
  try {
    const list = workList(db.query, { owner: "lane" }), owed = { backfill: false };
    await mark(Array.from({ length: 60 }, (_, i) => place(i + 1)));
    const seen: number[] = [];
    for (let look = 0; look < 4; look++) { const turn = await sliceTurn({ list, facts: db.query, owed }); seen.push(turn.claimed ? 0 : turn.backfilled); }
    assert.deepEqual(seen, [0, 100, 0, 50], "marked go, backfill go, marked go, backfill go while 60 marks are waiting");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM work WHERE kind='slice' AND status='done'"))[0]!.n, 40, "two batches of twenty");
  } finally { await db.pg.close(); }
});
