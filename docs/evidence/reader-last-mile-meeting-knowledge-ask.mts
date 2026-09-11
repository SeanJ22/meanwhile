import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { meetingKnowledgeAskProof } from "../../scripts/lib/reader-ask-meeting-knowledge-proof.ts";
import {
  readMeetingsProjection,
  requireReaderProofMeetingsProjection,
} from "../../lib/meetings/snapshot.ts";
import { currentCommentAccess } from "../../lib/registry/comment-access.ts";
import {
  prepareReaderProofRuntime,
  requiredPreparedReaderProofMeetingsAuthority,
} from "../../scripts/lib/reader-proof-runtime.ts";
await prepareReaderProofRuntime();
const snapshot = requireReaderProofMeetingsProjection(
  await readMeetingsProjection({ bypassCache: true }),
  requiredPreparedReaderProofMeetingsAuthority(),
);
const result = await meetingKnowledgeAskProof({
  snapshot,
  commentAccess: currentCommentAccess(),
});
writeFileSync(process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-meeting-knowledge-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ summaries: result.summaryDenominator, access: result.accessDenominator, queries: result.proofs.length, failed: result.proofs.filter((proof) => proof.status !== "PROVEN") }));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
