import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { meetingKnowledgeAskProof } from "../../scripts/lib/reader-ask-meeting-knowledge-proof.ts";
const result = await meetingKnowledgeAskProof();
writeFileSync("docs/evidence/reader-last-mile-meeting-knowledge-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ summaries: result.summaryDenominator, access: result.accessDenominator, queries: result.proofs.length, failed: result.proofs.filter((proof) => proof.status !== "PROVEN") }));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
