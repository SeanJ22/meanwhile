import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { getDb } from "../lib/db/index.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

test("the migrated Neon transport preserves concurrent empty event aggregates and typed query results",async()=>{
  await withMigratedRoutineStore("legiscan-bulk",async store=>{
    const db=getDb();
    const typed=async(ordinal:number)=>{
      const active=ordinal%2===0,body={ordinal,active};
      const result=await db.execute(sql`SELECT ${active}::boolean AS active,${ordinal}::integer AS ordinal,
        ${JSON.stringify(body)}::jsonb AS body`);
      assert.deepEqual(result.rows,[{active,ordinal,body}]);
    };
    await Promise.all(Array.from({length:8},async(_,ordinal)=>{
      await Promise.all([
        typed(ordinal),
        // Each concurrent read checks the production aggregate etag on an empty
        // event set, which must still return one row, then reads its empty value.
        store.latestReaderReadbacks([`missing-part-${ordinal}`]).then(events=>assert.deepEqual(events,[])),
      ]);
    }));
    await assert.rejects(async()=>{await db.execute(sql`SELECT 'invalid-fixture-boolean'::boolean`);},/boolean/i);
    await Promise.all([typed(9),store.latestReaderReadbacks(["missing-after-error"]).then(events=>assert.deepEqual(events,[]))]);
  });
});
