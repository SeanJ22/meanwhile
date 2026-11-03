import assert from "node:assert/strict";
import test from "node:test";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { metered, owedMs, runSliceLane, SLICE_BYTES_PER_HOUR } from "../lib/reader/slice-lane.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const ONE = "ocd-division/country:us/state:az/place:p001";

test("the lane builds places nobody asked for only while it owes no time, and marked slices never wait", async () => {
  const db = await migratedFactDb();
  try {
    for (const ddl of WORK_DDL) await db.pg.exec(ddl);
    await db.query("INSERT INTO entity(id,kind,name,state) SELECT 'ocd-division/country:us/state:az/place:p'||lpad(n::text,3,'0'),'place','P','AZ' FROM generate_series(1,150) n");
    const list = workList(metered(db.query), { owner: "cap-test" }), facts = metered(db.query);
    let now = 1_000_000, built = 0;
    const total = { built: 0, written: 0, backfilled: 0 };
    const look = async (advance = 0) => {
      now += advance; let stop = 0;
      await runSliceLane({ list, facts, stopRequested: () => stop++ >= 1, log: () => {}, clock: () => now, sleep: async () => {}, total });
      const gained = total.backfilled - built; built = total.backfilled; return gained;
    };
    assert.equal(await look(), 100, "the first look builds a hundred places");
    assert.ok(owedMs(SLICE_BYTES_PER_HOUR / 1.05) === 3_600_000 && owedMs(0) === 0 && owedMs(1) > 0, "the hour's allowance takes the whole hour; any read takes some time");
    assert.ok(Number((await db.query("SELECT position FROM pass_cursor WHERE name='slices:tab'"))[0]!.position) > now, "the time owed is kept, so a lane that starts again owes it too");
    assert.equal(await look(1), 0, "while the time owed has not run out, no place nobody asked for is built");
    await list.touch([{ kind: "slice", placeId: ONE, subjectId: ONE, field: "bodies", origin: { from: "loader" }, source: { source: "test" } }]);
    const marked = total.built; await look(1);
    assert.equal(total.built, marked, "a marked slice waits its turn too");
    await look(3_600_000);
    assert.ok(total.built > marked && total.backfilled === 100, "once the time owed has passed, the marked slice goes before the fifty places left");
    assert.equal(await look(3_600_000), 50, "and then the fifty are built");
  } finally { await db.pg.close(); }
});
