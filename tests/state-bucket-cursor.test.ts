import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { withStateBucketCursor } from "../lib/civic-data/state-bucket-cursor.ts";

test("bootstrap reads each source once and awaits one row before fetching another", async () => {
  const db = new PGlite();
  const statements: string[] = [];
  const client = { query: async (text: string, params?: unknown[]) => {
    statements.push(text);
    return db.query<Record<string, unknown>>(text, params);
  } };
  try {
    await db.exec("CREATE TABLE input(id integer); INSERT INTO input VALUES(1),(2),(3)");
    const rows: number[] = [];
    await withStateBucketCursor(client, async source => {
      await source.streamRows("SELECT id FROM input WHERE id>$1 ORDER BY id", [0], async row => {
        rows.push(Number(row.id));
        assert.equal(statements.filter(text => text.startsWith("FETCH")).length, rows.length);
        assert.equal((await source.query("SELECT $1::integer AS held", [row.id]))[0].held, row.id);
      });
    });
    assert.deepEqual(rows, [1, 2, 3]);
    assert.equal(statements.filter(text => text.includes("SELECT id FROM input")).length, 1);
    assert.equal(statements.filter(text => text.startsWith("FETCH")).length, 4);
    assert.equal(statements.at(-2), "CLOSE state_bucket_1");
    assert.equal(statements.at(-1), "ROLLBACK");

    await assert.rejects(withStateBucketCursor(client, source => source.streamRows("SELECT id FROM input", [], async () => {
      throw new Error("source row failed");
    })), /source row failed/);
    assert.deepEqual(statements.slice(-2), ["CLOSE state_bucket_1", "ROLLBACK"]);
    await assert.rejects(withStateBucketCursor(client, source => source.query("INSERT INTO input VALUES(4)", [])), /read-only/);
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM input")).rows[0].count, 3);
  } finally { await db.close(); }
});
