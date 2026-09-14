import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { floored } from "../lib/ops/denominator-floor.ts";
import type { ReaderCensus } from "../lib/holdings/reader-census.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/, "Exhaustive asset proof uses our local production build.");
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-portraits.json";
const inputPath = "docs/evidence/reader-last-mile-active-portraits.json";
const inputBytes = readFileSync(inputPath);
const input = JSON.parse(inputBytes.toString()) as {
  holdingsDigest: string;
  records: Array<{ auditId: string; url: string; holdingPath: string; expectedSha256: string; projectedIdentities: string[] }>;
};
// floored's fourth argument is the measured match count, not a minimum.
// Bind the selector to every currently applicable census portrait before HTTP
// execution, so fixing that count cannot hide a missing required asset.
const censusPath = process.env.READER_FINAL_PREPARED_CENSUS ?? "../reader-last-mile-final-prepared-census.json";
const census = JSON.parse(readFileSync(censusPath, "utf8")) as ReaderCensus;
assert.equal(input.holdingsDigest, census.holdingsDigest, "Portrait inventory belongs to different current holdings");
const applicable = new Set(census.rows.flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds));
const required = census.records.filter((record) => record.family === "portraits" && applicable.has(record.auditId));
const inventory = new Map(input.records.map((record) => [record.auditId, record]));
assert.equal(inventory.size, input.records.length, "Portrait inventory repeats an audit identity");
for (const record of required) {
  const actual = inventory.get(record.auditId);
  assert.ok(actual, `Required census portrait missing from HTTP inventory: ${record.auditId}`);
  assert.equal(actual.holdingPath, record.holdingPath, record.auditId);
  assert.equal(actual.url, record.canonicalIdentity.find((identity) => identity.startsWith("/")), record.auditId);
  assert.equal(actual.expectedSha256, census.holdings.find((holding) => holding.path === record.holdingPath)?.sha256, record.auditId);
}
floored("required portrait byte controls", "current applicable census records", required.length, required.length);
floored("active portrait byte controls", "canonical current portrait selector inventory", input.records.length, 0);
const records: unknown[] = [];
for (let start = 0; start < input.records.length; start += 8) {
  records.push(...await Promise.all(input.records.slice(start, start + 8).map(async (record) => {
    assert.ok(record.url.startsWith("/") && !record.url.startsWith("//"), record.auditId);
    const response = await fetch(new URL(record.url, base), { headers: { "x-wtp-synthetic-run": "reader-last-mile-portraits" } });
    assert.equal(response.status, 200, record.auditId);
    const contentType = response.headers.get("content-type");
    assert.match(contentType ?? "", /^image\//, record.auditId);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0, record.auditId);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actualSha256, record.expectedSha256, record.auditId);
    return { ...record, status: response.status, contentType, byteLength: bytes.length, actualSha256, result: "PROVEN" };
  })));
}
assert.equal(records.length, input.records.length, "Every active portrait must have an actual HTTP byte proof");
floored("active portrait byte controls", "canonical current portrait selector inventory", input.records.length, records.length);
const output = {
  exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  sourceInventory: inputPath,
  sourceInventorySha256: createHash("sha256").update(inputBytes).digest("hex"),
  holdingsDigest: input.holdingsDigest,
  execution: "Actual HTTP requests to every active canonical portrait URL on the local Next production server. Response image MIME and full bytes checked against committed vault SHA256.",
  expectedCount: input.records.length,
  returnedCount: records.length,
  records,
};
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ portraits: records.length, result: "PROVEN", buildId: output.buildId }));
