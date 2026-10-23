import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { captureSha256 } from "../scripts/ba01-evidence.mts";
import { credentials, SANITIZER_VERSION, scanText } from "../lib/ops/fixture-credentials.ts";

const root = new URL("../", import.meta.url);
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const record = JSON.parse(readFileSync(new URL("data/ballot/ba01-source-redactions.json", root), "utf8")) as {
  sanitizerVersion: string;
  captures: Record<string, {
    encoding: "identity" | "gzip";
    rawSha256: string; sanitizedSha256: string;
    rawDecodedSha256: string; sanitizedDecodedSha256: string;
    embeddedBodies: { pointer: string; rawSha256: string; sanitizedSha256: string }[];
  }>;
};

test("each redacted ballot capture retains its original fingerprint and exact archived bytes", () => {
  assert.equal(record.sanitizerVersion, SANITIZER_VERSION);
  assert.ok(Object.keys(record.captures).length > 0);
  for (const [path, item] of Object.entries(record.captures)) {
    const archived = readFileSync(new URL(path, root));
    const decoded = item.encoding === "gzip" ? gunzipSync(archived) : archived;
    assert.equal(digest(archived), item.sanitizedSha256, path);
    assert.equal(digest(decoded), item.sanitizedDecodedSha256, path);
    assert.notEqual(item.rawSha256, item.sanitizedSha256, path);
    assert.match(item.rawSha256, /^[0-9a-f]{64}$/, path);
    assert.match(item.rawDecodedSha256, /^[0-9a-f]{64}$/, path);
    assert.equal(captureSha256(archived), item.rawSha256, path);
    assert.equal(captureSha256(decoded), item.rawDecodedSha256, path);
    assert.deepEqual(credentials(scanText(decoded.toString("utf8"), digest)), [], path);
    for (const body of item.embeddedBodies) {
      let value: unknown = JSON.parse(decoded.toString("utf8"));
      for (const part of body.pointer.slice(1).split("/")) {
        assert.ok(value && typeof value === "object");
        value = (value as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      assert.equal(typeof value, "string");
      if (typeof value !== "string") throw new Error(`Expected captured text at ${path}${body.pointer}`);
      assert.equal(digest(value), body.sanitizedSha256, `${path}${body.pointer}`);
      assert.equal(captureSha256(value), body.rawSha256, `${path}${body.pointer}`);
    }
  }
});

test("changed archive bytes cannot pass as the original source capture", () => {
  const [path, item] = Object.entries(record.captures)[0];
  const altered = Buffer.concat([readFileSync(new URL(path, root)), Buffer.from("modified")]);
  assert.equal(captureSha256(altered), digest(altered));
  assert.notEqual(captureSha256(altered), item.rawSha256);
});
