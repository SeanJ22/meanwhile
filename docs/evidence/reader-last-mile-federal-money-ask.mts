import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { federalMoneyAskProof } from "../../scripts/lib/reader-ask-federal-money-proof.ts";
import { prepareReaderProofRuntime } from "../../scripts/lib/reader-proof-runtime.ts";
await prepareReaderProofRuntime();
const result = await federalMoneyAskProof();
writeFileSync(process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-federal-money-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ candidates: result.candidateDenominator, absences: result.absenceDenominator, executed: result.proofs.length, failed: result.proofs.filter((proof) => proof.status !== "PROVEN") }));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
