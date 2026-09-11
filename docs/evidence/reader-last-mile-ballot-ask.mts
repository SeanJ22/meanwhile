import { writeFileSync } from "node:fs";
import { ballotAskProof } from "../../scripts/lib/reader-ask-ballot-proof.ts";
import { prepareReaderProofRuntime } from "../../scripts/lib/reader-proof-runtime.ts";
const states = process.env.READER_BALLOT_STATES?.split(",").map((state) => state.trim()).filter(Boolean);
await prepareReaderProofRuntime();
const result = await ballotAskProof({ states });
writeFileSync(process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-ballot-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ denominator: result.denominator, queries: result.proofs.length, failed: result.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ subjectId: row.subjectId, mode: row.mode, missing: row.missing.map((record) => record.id), ownCandidateOnly: row.ownCandidateOnly })) }));
