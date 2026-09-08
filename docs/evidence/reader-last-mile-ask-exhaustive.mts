import { writeFileSync } from "node:fs";
import { exhaustiveAskProof } from "../../scripts/lib/reader-ask-proof.ts";
const evidence = await exhaustiveAskProof(console.log);
const outputPath = process.env.READER_PROOF_OUTPUT ?? new URL("./reader-last-mile-ask-exhaustive.json", import.meta.url);
writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ requests: evidence.proofs.length, passed: evidence.proofs.filter((proof) => proof.status === "PROVEN").length, failures: evidence.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ family: proof.family, subjectId: proof.subjectId, mode: proof.mode, missing: proof.missingRecords.length, unexpected: proof.unexpectedRecords.length })) }, null, 2));
