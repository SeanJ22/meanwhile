import assert from "node:assert/strict";
import test from "node:test";
import { officialsAskProof } from "../scripts/lib/reader-ask-officials-proof.ts";

test("every canonical official and sourced roster term note reaches actual Ask without a geographic claim", async () => {
  const proof = await officialsAskProof();
  assert.ok(proof.officialDenominator > 1400);
  assert.ok(proof.termNoteDenominator > 180);
  assert.equal(proof.proofs.length, proof.officialDenominator);
  assert.deepEqual(proof.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ id: row.nativeId, missing: row.missing, unexpected: row.unexpected, expectedContact: row.expectedContact, contacts: row.contacts, subject: row.resolvedSubjectId })), []);
});
