import assert from "node:assert/strict";
import test from "node:test";
import { repairFanOutReaderReadbacks } from "../lib/civic-data/fanout-reader-repair.ts";
import { fanOutReaderRepairRecord, parseRoutineReaderRepairRecords, serializeRoutineReaderRepairRecord } from "../lib/civic-data/reader-repair-protocol.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { FEDERAL_KEY_VOTE_SCOPE, federalKeyVoteMemberScope, FEDERAL_ROLLCALL_SCOPE, federalMemberVotesScope } from "../lib/votes/data-plane.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ReaderReadbackRepairOutcome } from "../lib/civic-data/reader-verification.ts";

test("fanout reader repair visits source partitions separately and reports a failed sibling without losing later work", async () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find(row => row.id === "meeting-doors")!;
  const store = new MemoryRoutineDataStore();
  store.listPromotionScopes = async () => [
    { recordClass: "CURATED_READER_RECORD", scope: "meeting-doors:AZ" },
    { recordClass: "CURATED_READER_RECORD", scope: "meeting-doors:NH" },
    { recordClass: "CURATED_READER_RECORD", scope: "meeting-doors:NJ" },
    { recordClass: "CURATED_READER_RECORD", scope: contract.scope },
    { recordClass: "CURATED_READER_RECORD", scope: "another-source:AZ" },
  ];
  const calls: string[] = [];
  let active = false;
  const result = await repairFanOutReaderReadbacks({ store, contract, now: "2026-10-19T00:00:00Z", repair: async part => {
    assert.equal(active, false, "only the current partition can hold its payload"); active = true;
    calls.push(part.scope);
    await Promise.resolve(); active = false;
    if (part.scope === "meeting-doors:NH") throw new Error("the NH publication is unreadable");
    return { kind: "CURRENT", receipt: { status: "PASS" } } as ReaderReadbackRepairOutcome;
  } });
  assert.deepEqual(calls, ["meeting-doors:AZ", "meeting-doors:NH", "meeting-doors:NJ"]);
  assert.deepEqual({ ...result, errors: [] }, { total: 3, passed: 2, failed: 1, deferred: 0, errors: [] });
  const record = fanOutReaderRepairRecord(contract, result);
  assert.equal(record.disposition, "REPAIR_FAILED");
  assert.match(record.error ?? "", /NH publication is unreadable/);
  assert.equal(record.receipt, null, "a summary never fabricates a global publication receipt");
  const parsed = parseRoutineReaderRepairRecords(serializeRoutineReaderRepairRecord(record), [contract]);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.records[0]?.partitions?.failed, 1);
  const good = fanOutReaderRepairRecord(contract, { total: 3, passed: 2, failed: 0, deferred: 1, errors: [] });
  assert.equal(good.disposition, "PARTITIONS");
  assert.deepEqual(parseRoutineReaderRepairRecords(serializeRoutineReaderRepairRecord(good), [contract]).issues, []);
  assert.ok(parseRoutineReaderRepairRecords(serializeRoutineReaderRepairRecord({ ...good, partitions: { total: 3, passed: 3, failed: 0, deferred: 1 } }), [contract]).issues.length > 0);
});


test("federal vote repair inventories the shared metadata and every exact member, without another vote family",async()=>{
  for(const [id,scope,memberScope,other] of [["federal-key-votes",FEDERAL_KEY_VOTE_SCOPE,federalKeyVoteMemberScope("congress:A000001"),federalMemberVotesScope("congress:A000001")],["congress-rollcalls",FEDERAL_ROLLCALL_SCOPE,federalMemberVotesScope("congress:A000001"),federalKeyVoteMemberScope("congress:A000001")]] as const) {
    const contract=requiredManualProductionContract(id),store=new MemoryRoutineDataStore();
    store.listPromotionScopes=async()=>[scope,memberScope,other].map(scope=>({recordClass:contract.recordClass,scope}));
    const calls:string[]=[];
    const result=await repairFanOutReaderReadbacks({store,contract,now:"2026-10-19T00:00:00Z",repair:async row=>{calls.push(row.scope);return {kind:"CURRENT",receipt:{status:"PASS"}} as ReaderReadbackRepairOutcome;}});
    assert.deepEqual(calls,[scope,memberScope]);assert.equal(result.passed,2);
  }
});
