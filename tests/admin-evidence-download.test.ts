import test from "node:test";
import assert from "node:assert/strict";
import { contentHash } from "../lib/control-plane/ids.ts";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { readVerifiedAdminEvidence } from "../app/(admin)/_mw/evidence-download.ts";

const origin = ADMIN_ORIGIN;
const path = "/api/admin/evidence/wi-123/at-456/ar-example";

test("Admin reassembles only the exact complete private capture and verifies its hash", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024 + 17);
  bytes.fill(65);
  const hash = contentHash(bytes);
  const chunkBytes = 4 * 1024 * 1024;
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.search);
    if (!url.search) return Response.json({ code: "CHUNKED_DOWNLOAD_REQUIRED", byteLength: bytes.length,
      contentHash: hash, chunkBytes, parts: 2 }, { status: 409 });
    const part = Number(url.searchParams.get("part"));
    const offset = part * chunkBytes;
    const body = bytes.slice(offset, Math.min(bytes.length, offset + chunkBytes));
    return new Response(body, { headers: { "x-evidence-source": "verified-original-capture",
      "x-evidence-sha256": hash, "x-evidence-full-length": String(bytes.length),
      "x-evidence-parts": "2", "x-evidence-part": String(part), "x-evidence-byte-offset": String(offset) } });
  }) as typeof fetch;
  const result = await readVerifiedAdminEvidence(path, origin, fetcher);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.filename, "ar-example.bin");
  assert.deepEqual(requests, ["", "?part=0", "?part=1"]);
});

test("Admin refuses altered, missing or cross-origin private evidence", async () => {
  await assert.rejects(readVerifiedAdminEvidence("https://elsewhere.example/api/admin/evidence/wi-123/at-456/ar-example",
    origin, fetch), /INVALID_PRIVATE_EVIDENCE_PATH/);
  const bytes = new TextEncoder().encode("original");
  const hash = contentHash(bytes);
  const altered = (async () => new Response(new TextEncoder().encode("altered!"), {
    headers: { "x-evidence-source": "verified-original-capture", "x-evidence-sha256": hash,
      "x-evidence-full-length": String(bytes.length), "x-evidence-parts": "1" },
  })) as typeof fetch;
  await assert.rejects(readVerifiedAdminEvidence(path, origin, altered), /PRIVATE_EVIDENCE_HASH_MISMATCH/);
  const unavailable = (async () => new Response(null, { status: 404 })) as typeof fetch;
  await assert.rejects(readVerifiedAdminEvidence(path, origin, unavailable), /PRIVATE_EVIDENCE_UNAVAILABLE/);
});
