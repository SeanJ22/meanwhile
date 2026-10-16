import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { readFile } from "node:fs/promises";

test("ballot workers read only matching state divisions from inline and encoded registry pointers", async () => {
  const db = new PGlite();
  try {
    for (const migration of ["0025_typical_fixer.sql", "0031_civic_payload_parts.sql"]) {
      await db.exec(await readFile(new URL(`../lib/db/migrations/${migration}`, import.meta.url), "utf8"));
    }
    const divisions = Array.from({ length: 160 }, (_, index) => ({ state: "AZ", label: "Alder County",
      ocdId: `ocd-division/country:us/state:az/county:foreign-${index}`, sourceDataset: "TIGER", unrelated: "x".repeat(600) }));
    divisions.push(...["one", "ambiguous"].map(id => ({ state: "NH", label: "Alder County",
      ocdId: `ocd-division/country:us/state:nh/county:${id}`, sourceDataset: "TIGER", unrelated: "x".repeat(600) })));
    divisions.push({ state: "NH", label: "Different County", ocdId: "other", sourceDataset: "TIGER", unrelated: "x".repeat(600) });
    const payload = { registry: { divisions, bodies: [{ unrelated: "y".repeat(100_000) }] } };
    const pointer = { key: "REGISTRY_RUNTIME_BINDING:US:reader-registry-runtime-bindings", payload, receipt: { decision: "GOOD" } };
    const memory = new MemoryRoutineDataStore();
    Object.assign(memory, { promotions: new Map([[pointer.key, pointer]]) });
    memory.readPromotion = async () => { throw new Error("The complete registry must not be read."); };
    memory.readCandidate = async () => { throw new Error("The complete registry candidate must not be read."); };
    const expected = divisions.filter(row => row.state === "NH" && row.label === "Alder County")
      .map(({ ocdId, label, state, sourceDataset }) => ({ ocdId, label, state, sourceDataset }));
    assert.deepEqual(await memory.readRegistryDivisions("NH", ["ALDER, COUNTY"]), expected);
    for (const encoded of [false, true]) {
      const partitioned = encoded ? partitionCivicPayload(payload) : { value: payload, parts: [] };
      for (const part of partitioned.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await db.exec("DELETE FROM civic_data_promotions");
      await db.query("INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)",
        [pointer.key, "registry-runtime-bindings", "REGISTRY_RUNTIME_BINDING", "US:reader-registry-runtime-bindings", "fixture", "2026-10-16T00:00:00Z", JSON.stringify(partitioned.value), '{"decision":"GOOD"}']);
      const reader = { db: drizzle(db) } as unknown as PostgresRoutineDataStore;
      const rows = await PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "NH", ["ALDER, COUNTY"]);
      assert.deepEqual([...rows].sort((a, b) => a.ocdId.localeCompare(b.ocdId)), [...expected].sort((a, b) => a.ocdId.localeCompare(b.ocdId)));
      assert.ok(Buffer.byteLength(JSON.stringify(rows)) < 512, "foreign states and unrelated registry fields never cross the wire");
      assert.deepEqual(await PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "TX", ["Alder County"]), []);
    }
  } finally { await db.close(); }
});
