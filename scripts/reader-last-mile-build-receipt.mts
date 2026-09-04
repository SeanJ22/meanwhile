import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { checkReaderTraces } from "../lib/holdings/reader-trace.ts";
import { readerProofSources } from "./lib/reader-proof-sources.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/);
const exactHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
execFileSync(process.execPath, ["scripts/check-build-output.mjs"], { stdio: "inherit" });
const trace = checkReaderTraces(process.cwd());
assert.deepEqual(trace.failures, []);
const response = await fetch(`${base}/api/build`);
assert.equal(response.status, 200);
const served = await response.json();
assert.equal(served.commit, exactHead, "The running production build must serve the frozen source head");
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const receipt = { exactHead, buildId, buildCompleted: true, servedBuild: served,
  buildLogSha256: createHash("sha256").update(readFileSync("../reader-final-build.log")).digest("hex"),
  traceRoutes: trace.routes, traceRequirements: trace.requirements, requiredHoldingFiles: trace.files,
  traceFailures: trace.failures.length, sourceHashes: readerProofSources() };
writeFileSync("docs/evidence/reader-last-mile-build-receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ exactHead, buildId, trace }));
