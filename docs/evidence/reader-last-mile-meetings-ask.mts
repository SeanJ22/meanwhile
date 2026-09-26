import { writeFileSync } from "node:fs";
import { meetingsAskProof } from "../../scripts/lib/reader-ask-meetings-proof.ts";
import {
  readMeetingsProjection,
  requireReaderProofMeetingsProjection,
} from "../../lib/meetings/snapshot.ts";
import {
  prepareReaderProofRuntime,
  requiredPreparedReaderProofMeetingsAuthority,
} from "../../scripts/lib/reader-proof-runtime.ts";
await prepareReaderProofRuntime();
const snapshot = requireReaderProofMeetingsProjection(
  await readMeetingsProjection({ bypassCache: true }),
  requiredPreparedReaderProofMeetingsAuthority(),
);
const proof = await meetingsAskProof({ snapshot }, console.log);
writeFileSync(process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-meetings-ask.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ meetings: proof.meetingDenominator, documents: proof.documentDenominator, outcomes: proof.outcomeSittingDenominator, queries: proof.proofs.length, unbound: proof.unbound.length, failed: proof.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ ids: row.meetingIds, missing: row.missing.length, unexpected: row.unexpected.length, mode: row.mode })) }));
// Preserve the complete receipt, then stop the orchestrator at the failed
// executor instead of spending the rest of a full proof before census rejects it.
if (proof.proofs.some(row => row.status !== "PROVEN")) process.exitCode = 1;
