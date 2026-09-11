import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { stateMoneyAskProof } from "../../scripts/lib/reader-ask-money-proof.ts";
import { prepareReaderProofRuntime } from "../../scripts/lib/reader-proof-runtime.ts";
await prepareReaderProofRuntime();
const result = await stateMoneyAskProof();
writeFileSync(process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-money-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ targets: result.targetDenominator, executed: result.proofs.length, expectedFinanceRecords: result.proofs.reduce((n, proof) => n + proof.expectedRecordIds.length, 0), returnedFinanceRecords: result.proofs.reduce((n, proof) => n + proof.returnedRecordIds.length, 0), explicitOursGapTargets: result.proofs.filter((proof) => proof.expectedFinance.some((record) => record.filingState === "OURS_GAP")).length, proven: result.proofs.filter((proof) => proof.status === "PROVEN").length, dispositions: result.dispositions.length }, null, 2));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
