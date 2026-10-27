import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/pglite";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { proofConsistentSuccess, routineClockCandidateRead, routineClockPointerRead } from "../lib/civic-data/store.ts";
import type { ValidationReceipt } from "../lib/civic-data/types.ts";

test("job clocks retain their exact receipt proof without downloading excluded source records", async () => {
  const { pg, publish } = await migratedReaderDb();
  const at = "2026-10-19T00:00:00.000Z", id = "clock:excluded-record", scope = "federal-supported";
  try {
    await publish({ id, at, scope, recordClass: "FEC_FUNDING", sourceId: "fec-open-api", value: { records: [] },
      excludedFacts: [{ key: "foreign", code: "HELD", detail: "This record belongs to the audit, not the source clock.", record: "EXCLUDED_SOURCE_BODY".repeat(100_000) }] });
    const db = drizzle(pg) as unknown as Parameters<typeof routineClockPointerRead>[0];
    const pointer = (await routineClockPointerRead(db,"FEC_FUNDING",scope))[0];
    assert.ok(pointer.validationReceipt);
    const row = (await routineClockCandidateRead(db,id))[0];
    const record = { candidate: row.candidate as NonNullable<Parameters<typeof proofConsistentSuccess>[0]>["candidate"], state: row.state as "PROMOTED", acquisitionSucceeded: row.acquisitionSucceeded,
      receipt: row.validationReceipt, promotedVersion: row.promotedVersionId, lastKnownGoodVersion: row.lastKnownGoodVersionId,
      failureCode: row.failureCode, failureDetail: row.failureDetail };
    const proof = { sourceId: pointer.sourceId, recordClass: "FEC_FUNDING" as const, scope, versionId: id, lastKnownGoodVersionId: id, receipt: pointer.validationReceipt };
    assert.equal(proofConsistentSuccess(record,proof),at);
    const bytes = JSON.stringify({pointer,row});
    assert.ok(bytes.length < 10_000, `${bytes.length} bytes for a clock carrying a 2 MB excluded source record`);
    assert.ok(!bytes.includes("EXCLUDED_SOURCE_BODY"));
    const statement = routineClockPointerRead(db,"FEC_FUNDING",scope).toSQL();
    const column = statement.sql.includes('"civic_data_promotions"."validation_receipt"') ? '"civic_data_promotions"."validation_receipt"' : '"validation_receipt"';
    const forged = statement.sql.replaceAll(column,
      `jsonb_set("civic_data_promotions"."validation_receipt",'{excludedFacts,0,record}','"detached source record"'::jsonb)`);
    assert.notEqual(forged,statement.sql,"the detached receipt is actually planted in SQL");
    const changed = (await pg.query<unknown[]>(forged,statement.params,{rowMode:"array"})).rows[0][6] as ValidationReceipt;
    assert.equal(proofConsistentSuccess(record,{...proof,receipt:changed}),undefined,
      "changing only an excluded record still breaks exact receipt equality");
  } finally { await pg.close(); }
});
