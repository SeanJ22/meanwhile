import assert from "node:assert/strict";
import test from "node:test";
import { stateMoneyAskProof } from "../scripts/lib/reader-ask-money-proof.ts";

test("every current eligible state-money target survives the actual Ask route with exact totals, provenance, gap states and counts", async () => {
  const result = await stateMoneyAskProof();
  assert.ok(result.proofs.length >= 297);
  assert.ok(result.proofs.some((proof) => proof.expectedFinance.some((record) => record.filingState === "OURS_GAP")));
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ target: proof.target, missing: proof.missing, unexpected: proof.unexpected, countAgrees: proof.countAgrees })), []);
  const hobbs = result.proofs.find((proof) => proof.target === "ballot-az-pima:governor:hobbs-katie")!;
  const held = hobbs.returnedRecords.find((record) => record.finance?.filingState === "FILED")!;
  assert.equal(held.finance?.totals.receipts, 11109719.95);
  assert.equal(held.finance?.totals.expenditures, 14355612.69);
  const biggs = result.proofs.find((proof) => proof.target === "ballot-az-pima:governor:biggs-andy")!;
  assert.ok(biggs.returnedRecords.every((record) => record.canonicalSubjectId !== hobbs.target));
});
