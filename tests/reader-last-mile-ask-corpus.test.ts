import assert from "node:assert/strict";
import test from "node:test";
import { corpusAskProof } from "../scripts/lib/reader-ask-corpus-proof.ts";

test("every quotable current corpus snapshot reaches Ask with its exact identity, verbatim passage and provenance", async () => {
  const evidence = await corpusAskProof();
  assert.equal(evidence.proofs.length, evidence.corpusSnapshotCount, "every snapshot has an executed proof or explicit extraction/quotability disposition");
  const executed = evidence.proofs.filter((proof) => proof.executionLevel === "REAL_ROUTE_HANDLER");
  assert.ok(executed.length >= 78, "finite current eligible snapshot denominator");
  for (const proof of executed) {
    assert.equal(proof.httpStatus, 200, proof.snapshotId);
    assert.equal(proof.modelAnswer, null, proof.snapshotId);
    assert.equal(proof.countAgrees, true, proof.snapshotId);
    assert.ok(proof.expectedRecordIds?.includes(proof.snapshotId));
    assert.deepEqual(proof.missingExpectedRecords, [], proof.snapshotId);
  }
  assert.ok(evidence.proofs.filter((proof) => proof.executionLevel === "NOT_EXECUTED").every((proof) => /No readable extraction|No quotable matching passage/.test(proof.reason ?? "")), "not-executed is an exact current eligibility reason, never an excuse for a held quotable record");
});
