import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateProfileAskProof } from "../scripts/lib/reader-ask-candidate-profile-proof.ts";

test("all held candidate bios and verified links survive the actual Ask route with exact field provenance", async () => {
  const result = await candidateProfileAskProof();
  assert.equal(result.eligibleFields, 169);
  assert.deepEqual(result.proofs.filter(proof => proof.status !== "PROVEN"), []);
});
