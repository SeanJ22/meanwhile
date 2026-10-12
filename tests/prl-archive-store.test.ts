import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeObjectKey,
  signatureV4,
} from "../lib/sources/prl/archive-store.ts";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";

test("signatureV4 reproduces the published AWS SigV4 get-vanilla vector", () => {
  // AWS Signature V4 Test Suite, `get-vanilla`. If the canonical request,
  // string-to-sign and signing-key chain are correct, this exact signature
  // falls out — so the S3 client's crypto is proven without a live endpoint.
  const emptyHash = createHash("sha256").update("").digest("hex");
  const { authorization, signedHeaders } = signatureV4({
    method: "GET",
    url: "https://example.amazonaws.com/",
    region: "us-east-1",
    service: "service",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    headers: {},
    payloadHash: emptyHash,
    amzDate: "20150830T123600Z",
  });
  assert.equal(signedHeaders, "host;x-amz-date");
  assert.match(
    authorization,
    /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/,
    authorization,
  );
});

test("LocalFileArchiveStore round-trips put / get / head / list", async () => {
  const root = mkdtempSync(join(tmpdir(), "prl-archive-"));
  try {
    const store = new LocalFileArchiveStore(root);
    const body = new TextEncoder().encode("bioguide,date\nB000944,2017-06-21\n");
    const meta = await store.put("statements-national/part-00000.csv", body);
    assert.equal(meta.size, body.byteLength);

    const got = await store.get("statements-national/part-00000.csv");
    assert.ok(got);
    assert.equal(new TextDecoder().decode(got), "bioguide,date\nB000944,2017-06-21\n");

    const head = await store.head("statements-national/part-00000.csv");
    assert.equal(head?.size, body.byteLength);
    assert.equal(await store.head("statements-national/missing.csv"), null);
    assert.equal(await store.get("statements-national/missing.csv"), null);

    await store.put("statements-national/part-00001.csv", new Uint8Array([1, 2, 3]));
    await store.put("newsletters/part-00000.json", new Uint8Array([9]));
    const listed = await store.list("statements-national/");
    assert.deepEqual(listed.map((m) => m.key), [
      "statements-national/part-00000.csv",
      "statements-national/part-00001.csv",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("object keys refuse traversal and absolute paths", () => {
  assert.throws(() => assertSafeObjectKey("/etc/passwd"), /UNSAFE/);
  assert.throws(() => assertSafeObjectKey("a/../b"), /UNSAFE/);
  assert.throws(() => assertSafeObjectKey("a\\b"), /UNSAFE/);
  assert.doesNotThrow(() => assertSafeObjectKey("statements-national/2026-09-17/part-00000.csv"));
});

test("S3 ListObjectsV2 uses the bucket root and follows opaque continuation tokens", async () => {
  const { S3ArchiveStore } = await import("../lib/sources/prl/archive-store.ts");
  const priorFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (value: string | URL | Request) => {
    const url = new URL(String(value)); urls.push(url);
    assert.equal(url.pathname, "/bucket");
    assert.equal(url.searchParams.get("prefix"), "archive/");
    return new Response(urls.length === 1
      ? "<ListBucketResult><Contents><Key>archive/a.json</Key><Size>2</Size></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken></ListBucketResult>"
      : "<ListBucketResult><Contents><Key>archive/b.json</Key><Size>3</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>");
  }) as typeof fetch;
  try {
    const store = new S3ArchiveStore({ endpoint: "https://archive.example", region: "us-east-1", bucket: "bucket", accessKeyId: "fixture", secretAccessKey: "fixture" });
    assert.deepEqual(await store.list("archive/"), [{ key: "archive/a.json", size: 2 }, { key: "archive/b.json", size: 3 }]);
    assert.equal(urls[1].searchParams.get("continuation-token"), "a&b");
    await assert.rejects(store.get(""), /UNSAFE/);
  } finally { globalThis.fetch = priorFetch; }
});
