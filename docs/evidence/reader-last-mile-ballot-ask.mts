import { writeFileSync } from "node:fs";
import { ballotAskProof } from "../../scripts/lib/reader-ask-ballot-proof.ts";
const result = await ballotAskProof();
writeFileSync("docs/evidence/reader-last-mile-ballot-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ denominator: result.denominator, queries: result.proofs.length, failed: result.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ subjectId: row.subjectId, mode: row.mode, missing: row.missing.map((record) => record.id), ownCandidateOnly: row.ownCandidateOnly })) }));
