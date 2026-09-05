import assert from "node:assert/strict";
import test from "node:test";
import { exhaustiveAskProof } from "../scripts/lib/reader-ask-proof.ts";

test("all held votes, body contacts, unwindowed actions and linked county records survive the real Ask route without tail limits", async () => {
  const evidence = await exhaustiveAskProof();
  assert.ok(evidence.proofs.filter((proof) => proof.family === "recorded-votes").length >= 667);
  assert.ok(evidence.proofs.some((proof) => proof.family === "body-contacts" && proof.expectedRecords.length > 8));
  assert.ok(evidence.proofs.some((proof) => proof.family === "recorded-votes" && proof.expectedRecords.length > 12));
  assert.ok(evidence.proofs.some((proof) => proof.family === "official-actions" && proof.expectedRecords.length > 25));
  assert.deepEqual(evidence.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ family: proof.family, id: proof.subjectId, mode: proof.mode, missing: proof.missingRecords, unexpected: proof.unexpectedRecords })), []);
});
