import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { floored } from "../lib/ops/denominator-floor.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/, "Exhaustive asset proof uses our local production build.");
const inputPath = "docs/evidence/reader-last-mile-active-portraits.json";
const inputBytes = readFileSync(inputPath);
const input = JSON.parse(inputBytes.toString()) as {
  holdingsDigest: string;
  records: Array<{ auditId: string; url: string; holdingPath: string; expectedSha256: string; projectedIdentities: string[] }>;
};
floored("active portrait byte controls", "canonical current portrait selector inventory", input.records.length, 1000);
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
writeFileSync("docs/evidence/reader-last-mile-portraits.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ portraits: records.length, result: "PROVEN", buildId: output.buildId }));
