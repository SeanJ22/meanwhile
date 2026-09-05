import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { keyVotesAskProof } from "../../scripts/lib/reader-ask-key-votes-proof.ts";
const result = await keyVotesAskProof();
writeFileSync("docs/evidence/reader-last-mile-key-votes-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ executed: result.proofs.length, passed: result.proofs.filter((proof) => proof.status === "PROVEN").length, failures: result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ id: proof.subjectId, missing: proof.missing.length, entries: proof.missingEntries.length, bills: proof.missingBills, unexpected: proof.unexpectedKeys })) }, null, 2));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
