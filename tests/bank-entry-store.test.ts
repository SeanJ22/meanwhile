import test from "node:test";
import assert from "node:assert/strict";
import { bankEntrySelection, createBankEntryStore, type BankSql } from "../lib/control-plane/bank-entry-store.ts";
import { readFieldManual, writeFieldManual, newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
const stamp = "2026-10-06T05:00:00Z";
const entry = newFieldManualEntry("test", "route", { role:"SHARED", kind:"ROUTE", title:"route", summary:"saved", outcome:"YIELDED", observedAt:stamp });
test("SQL scopes roles, states, place boundaries, kinds and exact exhausted subject with parameters", () => {
 const q=bankEntrySelection({role:"SCOUT",state:"AZ",recordClass:"Meetings",platform:"Legistar",ocdIds:["ocd-division/country:us/state:az#seat"],bodyIds:["b"],subjectId:"subject' OR true--",kinds:["ROUTE"]});
 assert(!q.text.includes("subject' OR true")); assert(q.params.includes("subject' OR true--")); assert(q.params.includes("az"));
 assert(q.text.includes("left(subject, length(scope) + 1)")); assert(q.text.includes("body_ids &&")); assert(q.text.includes("kind = ANY"));
});
test("normal read/write signatures use entry storage and never read or rewrite the legacy live row", async () => {
 const repos=createMemoryRepositories(); repos.fieldManual.read=async id=>{ assert.equal(id,"write-errors");return null; };
 repos.fieldManual.put=async()=>{ throw Error("aggregate must not be written"); };
 let writes=0;const bankEntries={readEntries:async()=>({store:{formatVersion:1 as const,updatedOn:stamp,entries:[entry]},total:5000}),mergeEntries:async()=>{writes++;}};
 const read=await readFieldManual({...repos,bankEntries},{state:"az"}); assert.equal(read.projection.total,5000); assert.equal(read.projection.entryIds[0],entry.id);
 assert.deepEqual(await writeFieldManual({...repos,bankEntries},[entry],stamp),{written:1});assert.equal(writes,1);
});
test("failed entry write rolls back the pinned transaction instead of claiming persistence", async () => {
 const calls:string[]=[];const sql:BankSql={query:async text=>{calls.push(text);if(text.startsWith("INSERT"))throw Error("write failed");return [];},withPinnedConnection:async fn=>fn(sql)};
 await assert.rejects(createBankEntryStore(sql).mergeEntries([entry],stamp),/write failed/);
 assert(calls.includes("ROLLBACK"));assert(!calls.includes("COMMIT"));
});
test("writes refuse unpinned HTTP transactions; damaged SQL reads cannot become an empty Bank",async()=>{
 const bank=createBankEntryStore({query:async()=>({bad:true})});
 await assert.rejects(bank.mergeEntries([entry],stamp),/PINNED_TRANSACTION_REQUIRED/);
 await assert.rejects(bank.readEntries({}),/QUERY_UNREADABLE/);
});
