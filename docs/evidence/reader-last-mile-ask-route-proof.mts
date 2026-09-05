import { writeFileSync } from "node:fs";
import { corpusAskProof } from "../../scripts/lib/reader-ask-corpus-proof.ts";
const output = await corpusAskProof();
writeFileSync(new URL("./reader-last-mile-ask-route-proof.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ snapshots: output.corpusSnapshotCount, subjects: output.subjectCount, executed: output.proofs.filter((proof) => proof.executionLevel === "REAL_ROUTE_HANDLER").length, passed: output.proofs.filter((proof) => proof.status === "PROVEN").length, missing: output.proofs.filter((proof) => proof.status === "ELIGIBLE_QUERY_NOT_FULLY_RETRIEVED").map((proof) => ({ subjectId: proof.subjectId, snapshotId: proof.snapshotId, mode: proof.mode, missing: proof.missingExpectedRecords?.length })), skipped: output.proofs.filter((proof) => proof.executionLevel === "NOT_EXECUTED").map((proof) => ({ snapshotId: proof.snapshotId, reason: proof.reason })) }, null, 2));
