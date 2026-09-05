import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { officialsAskProof } from "../../scripts/lib/reader-ask-officials-proof.ts";
const result = await officialsAskProof(console.log);
writeFileSync("docs/evidence/reader-last-mile-officials-ask.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ officials: result.officialDenominator, termNotes: result.termNoteDenominator, queries: result.proofs.length, failed: result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ nativeId: proof.nativeId, mode: proof.mode, missing: proof.missing.length, unexpected: proof.unexpected.length, contactAgrees: proof.contactAgrees })) }));
assert.ok(result.proofs.every((proof) => proof.status === "PROVEN"));
