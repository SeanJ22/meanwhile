import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { memoryAppendOnlyRepository } from "../lib/control-plane/repository/memory.ts";
import { fileAppendOnlyRepository } from "../lib/control-plane/repository/file-store.ts";
import { pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
import { assertNeededProductionRead } from "../scripts/rh01-network.mjs";

test("immutable append coordinates preserve absent and duplicate payload identities in every native provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-log-coordinate-")), db = new PGlite();
  type Record = { readonly id?: string; readonly body: string };
  try {
    await db.exec("CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key)); CREATE TABLE cp_log_coordinate(log_key text,record_id text,position bigint,recorded_at timestamptz,changed_at timestamptz DEFAULT now(),record jsonb,PRIMARY KEY(log_key,record_id))");
    const sql = { query: async (text: string, params: readonly unknown[] = []) => {
      if (/^\s*SELECT/.test(text)) assertNeededProductionRead(text);
      return (await db.query(text, [...params])).rows;
    } };
    const providers = [memoryAppendOnlyRepository<Record>("coordinate"), fileAppendOnlyRepository<Record>(directory, "coordinate"), pgAppendOnlyRepository<Record>(sql, "coordinate")];
    for (const repo of providers) {
      const at = "2026-10-20T13:00:00.000Z", key = "one-place";
      const records = [{ body: "no payload id" }, { id: "duplicate", body: "first" }, { id: "duplicate", body: "second" }];
      for (let n = 0; n < records.length; n++) await repo.append(key, `append-${n}`, records[n], at);
      for (let n = 0; n < records.length; n++) assert.deepEqual(await repo.readRecord!(key, `append-${n}`), records[n]);
      assert.equal(await repo.readRecord!(key, "missing"), null);
      assert.equal(await repo.readRecord!("different-place", "append-0"), null);
      const held = await repo.readRecord!(key, "append-1");
      Object.assign(held!, { body: "changed caller copy" });
      assert.deepEqual(await repo.readRecord!(key, "append-1"), records[1]);
    }
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
