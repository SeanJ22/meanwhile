import assert from "node:assert/strict";
import test from "node:test";
import { heldSubjectDb } from "./helpers/held-subject-db.ts";

test("DG reader fixtures apply the full real migration journal and retain actual promotion constraints", async () => {
  const db = await heldSubjectDb();
  try {
    const columns = await db.query(`SELECT column_name,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='civic_data_promotions' ORDER BY ordinal_position`);
    assert.deepEqual(columns.map(row => row.column_name), ["key", "source_id", "record_class", "scope", "current_version_id",
      "last_known_good_version_id", "promoted_at", "payload", "validation_receipt"]);
    assert.ok(columns.every(row => row.is_nullable === "NO"));
    await assert.rejects(db.query("INSERT INTO civic_data_promotions(key,payload,record_class) VALUES('incomplete','{}','REGISTRY_RUNTIME_BINDING')"), /null value/);
    await db.saveRegistry("AZ", { bodies: [{ id: "held-body" }], divisions: [], memberships: [] });
    const rows = await db.query(`SELECT source_id,scope,current_version_id=last_known_good_version_id AS known_good,
      validation_receipt->>'decision' AS decision,reader_payload_value(payload)#>>'{bodies,0,id}' AS held_id FROM civic_data_promotions`);
    assert.deepEqual(rows, [{ source_id: "dg-held-registry-fixture", scope: "US-AZ:reader-registry-runtime", known_good: true, decision: "GOOD", held_id: "held-body" }]);
    const latest = await db.query(`SELECT to_regclass('public.rebuild_queue') AS retired,
      pg_get_functiondef('fact_changed()'::regprocedure) AS trigger_definition`);
    assert.equal(latest[0]!.retired, null);
    assert.ok(!String(latest[0]!.trigger_definition).includes("INSERT INTO rebuild_queue"), "the final committed retirement migration ran");
  } finally { await db.pg.close(); }
});
