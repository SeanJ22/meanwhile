import assert from "node:assert/strict";
import test from "node:test";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { PEOPLE_SOURCE_CONTRACTS } from "../lib/civic-data/people-source-contracts.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { PUBLISH_NOW_DATABASE_CONTRACT, ROUTINE_SUPERVISOR_DATABASE_CONTRACT } from "../lib/civic-data/database-byte-contract.ts";

test("every registered source and each supervisor declares its database transfer", () => {
  for (const source of [...ROUTINE_SOURCE_CONTRACTS,...MANUAL_PRODUCTION_SOURCE_CONTRACTS,...PEOPLE_SOURCE_CONTRACTS,
    PUBLISH_NOW_DATABASE_CONTRACT,ROUTINE_SUPERVISOR_DATABASE_CONTRACT]) {
    assert.ok(Number.isSafeInteger(source.databaseBytesPerRun) && source.databaseBytesPerRun > 0, source.id);
    assert.ok(Number.isSafeInteger(source.databaseBytesPerUnchangedRun) && source.databaseBytesPerUnchangedRun > 0, source.id);
    assert.ok(["MEASURED","EXPECTED"].includes(source.databaseByteBasis), source.id);
  }
  for (const task of AUTOMATIC_REFRESH_TASKS) assert.ok(task.contract.databaseBytesPerRun! > 0, task.id);
});
