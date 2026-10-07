import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { auditExtraction } from "../lib/control-plane/workers/auditor.ts";
import type { AuditorWorkerInput } from "../lib/control-plane/workers/types.ts";

test("the auditor refuses a schema-1 extraction contract", () => {
  assert.throws(
    () => auditExtraction({ context: { contract: { schemaVersion: 1 } } } as unknown as AuditorWorkerInput),
    /AUDITOR_CONTRACT_UNSUPPORTED/,
  );
});

test("isolated auditor and source-inventory helpers never import producer procedures or ambient I/O", () => {
  for (const file of ["auditor.ts", "generalized-auditor.ts", "record-evidence.ts", "record-verification.ts"]) {
    const source = readFileSync(new URL(`../lib/control-plane/workers/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:node:|https?:|[a-zA-Z@]|\.\/(?:generalized-)?(?:parser|validator)\.ts)/);
    assert.doesNotMatch(source, /\b(?:parseLegistarEvents|parseGeneralizedRecords|validateExtraction|validateGeneralizedExtraction|fetch|require|process)\s*\(/);
    assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  }
});
