import assert from "node:assert/strict";
import test from "node:test";
import { ballotAskProof } from "../scripts/lib/reader-ask-ballot-proof.ts";

test("every held canonical ballot filing, contest, measure, absence and adopted analysis survives the real Ask route", async () => {
  const result = await ballotAskProof();
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ nativeIds: proof.nativeIds, missing: proof.missing, ownCandidateOnly: proof.ownCandidateOnly })), []);
  assert.equal(result.proofs.filter((proof) => proof.family === "ballot-candidacies").length, result.denominator.candidacies);
  assert.equal(result.proofs.filter((proof) => proof.family === "ballot-contests-measures").length, result.denominator.contests);
  assert.equal(result.proofs.flatMap((proof) => proof.returnedRecords.filter((record) => record.kind === "MEASURE_ANALYSIS")).length, result.denominator.adoptedAnalyses);
  assert.equal(result.denominator.filedContacts, 275);
  assert.equal(result.proofs.flatMap((proof) => proof.expectedRecords.filter((record) => record.kind === "CONTACT")).length, result.denominator.filedContacts);
});
