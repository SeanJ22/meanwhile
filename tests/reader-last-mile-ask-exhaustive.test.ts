import assert from "node:assert/strict";
import test from "node:test";
import { exhaustiveAskProof } from "../scripts/lib/reader-ask-proof.ts";

test("all held votes, body contacts, unwindowed actions and linked county records survive the real Ask route without tail limits", async () => {
  const evidence = await exhaustiveAskProof(() => {}, {
    readStateVotes: async () => ({
      promoted: [],
      readbacks: ["US-AZ", "US-NH", "US-NJ"].map((scope) => ({
        scope: scope as "US-AZ" | "US-NH" | "US-NJ",
        kind: "NOT_RECORDED" as const,
        versionId: null,
      })),
    }),
  });
  assert.equal(evidence.proofs.filter((proof) => proof.family === "recorded-votes").length, 539);
  assert.ok(evidence.stateVoteAuthorityReadbacks.every((readback) => readback.kind === "NOT_RECORDED"));
  assert.ok(evidence.proofs.some((proof) => proof.family === "body-contacts" && proof.expectedRecords.length > 8));
  assert.ok(evidence.proofs.some((proof) => proof.family === "recorded-votes" && proof.expectedRecords.length > 12));
  assert.ok(evidence.proofs.some((proof) => proof.family === "official-actions" && proof.expectedRecords.length > 25));
  assert.deepEqual(evidence.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ family: proof.family, id: proof.subjectId, mode: proof.mode, missing: proof.missingRecords, unexpected: proof.unexpectedRecords })), []);
});
