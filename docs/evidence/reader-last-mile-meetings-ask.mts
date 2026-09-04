import { writeFileSync } from "node:fs";
import { meetingsAskProof } from "../../scripts/lib/reader-ask-meetings-proof.ts";
const proof = await meetingsAskProof(console.log);
writeFileSync("docs/evidence/reader-last-mile-meetings-ask.json", JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ meetings: proof.meetingDenominator, documents: proof.documentDenominator, outcomes: proof.outcomeSittingDenominator, queries: proof.proofs.length, unbound: proof.unbound.length, failed: proof.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ ids: row.meetingIds, missing: row.missing.length, unexpected: row.unexpected.length, mode: row.mode })) }));
