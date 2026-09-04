import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { bodyRenderProof } from "../../scripts/lib/reader-body-render-proof.ts";
const result = await bodyRenderProof();
writeFileSync("docs/evidence/reader-last-mile-bodies.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ cases: result.cases.length, failures: result.failures.length, firstFailures: result.failures.slice(0, 10), unsupported: result.unsupported }, null, 2));
assert.equal(result.failures.length, 0);
