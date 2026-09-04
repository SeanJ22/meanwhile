import assert from "node:assert/strict";
import test from "node:test";
import { federalMoneyAskProof } from "../scripts/lib/reader-ask-federal-money-proof.ts";

test("all held FEC primary totals and sourced absences survive actual Ask with exact identity and provenance", async () => {
  const result = await federalMoneyAskProof();
  assert.equal(result.proofs.length, result.candidateDenominator + result.absenceDenominator);
  assert.equal(result.proofs.length, 38);
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN"), []);
});
