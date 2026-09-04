import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { checkReaderTraces, missingReaderTraceFiles, readerTraceRequirements } from "../lib/holdings/reader-trace.ts";

test("every dynamic reader contract fails if one holding is removed from deployment tracing", () => {
  const contracts = readerTraceRequirements(process.cwd());
  assert.ok(contracts.length >= 20);
  for (const contract of contracts) {
    const traced = new Set(contract.files);
    assert.deepEqual(missingReaderTraceFiles(contract.files, traced), []);
    for (const file of contract.files) {
      traced.delete(file);
      assert.ok(missingReaderTraceFiles(contract.files, traced).includes(file), `${contract.route}: failed to catch removed ${file}`);
      traced.add(file);
    }
  }
});

test("the completed Next production bundle includes every declared runtime holding", (t) => {
  if (!existsSync(".next/BUILD_ID")) return t.skip("No completed build; postbuild executes the mandatory deployed trace proof.");
  assert.deepEqual(checkReaderTraces(process.cwd()).failures, []);
});
