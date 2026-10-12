import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ASSET_REMOTE,
  assetRemoteBase,
  fetchAssetFromRemote,
  remoteAssetUrl,
} from "../lib/ops/asset-remote.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Bytes that do not hash to the name they were requested under are refused, whatever the transport said. A fetch is injected; nothing touches the network. */

const A_REAL_HASH = "73a2702c72cd24fc93faa7de2d6df09a8e0d6c858d23639f55d8febd42d5f042";

test("the default remote is the public store, committed rather than configured", () => {
  assert.equal(DEFAULT_ASSET_REMOTE, "https://raw.githubusercontent.com/SeanJ22/wtp-assets/main");
  assert.equal(assetRemoteBase({} as NodeJS.ProcessEnv), DEFAULT_ASSET_REMOTE);
});

test("WTP_ASSET_REMOTE overrides the default, and trailing slashes do not double up", () => {
  assert.equal(
    assetRemoteBase({ WTP_ASSET_REMOTE: "https://example.test/store/" } as unknown as NodeJS.ProcessEnv),
    "https://example.test/store",
  );
  assert.equal(assetRemoteBase({ WTP_ASSET_REMOTE: "   " } as unknown as NodeJS.ProcessEnv), DEFAULT_ASSET_REMOTE);
});

test("the remote path shards on the first two hex characters, matching the local store", () => {
  assert.equal(
    remoteAssetUrl(A_REAL_HASH, ".jpg", {} as NodeJS.ProcessEnv),
    `${DEFAULT_ASSET_REMOTE}/73/${A_REAL_HASH}.jpg`,
  );
  // An extension with or without its dot resolves the same way.
  assert.equal(
    remoteAssetUrl(A_REAL_HASH, "jpg", {} as NodeJS.ProcessEnv),
    remoteAssetUrl(A_REAL_HASH, ".jpg", {} as NodeJS.ProcessEnv),
  );
});

test("a guessed identifier is refused as an address, not sent as one", () => {
  assert.throws(() => remoteAssetUrl("not-a-hash", ".jpg"), /not a sha-256/);
  assert.throws(() => remoteAssetUrl(A_REAL_HASH.toUpperCase(), ".jpg"), /not a sha-256/);
  assert.throws(() => remoteAssetUrl(A_REAL_HASH.slice(0, 63), ".jpg"), /not a sha-256/);
});

test("bytes that hash correctly are accepted and returned", async () => {
  const body = Buffer.from("the actual picture bytes");
  const hash = createHash("sha256").update(body).digest("hex");
  const result = await fetchAssetFromRemote(hash, ".jpg", {
    fetchImpl: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sha256, hash);
  assert.equal(result.bytes, body.length);
  assert.ok(result.body?.equals(body));
});

test("HTTP 200 carrying the WRONG bytes is REFUSED — the branch a status check cannot reach", async () => {
  /*
   * This is the guard. An error page, a proxy interstitial, a truncated read,
   * or a file replaced at the same name all arrive as a perfectly healthy 200.
   */
  const wrong = Buffer.from("<html><title>404 — Not Found</title></html>");
  const result = await fetchAssetFromRemote(A_REAL_HASH, ".jpg", {
    fetchImpl: (async () => new Response(wrong, { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 200);
  assert.notEqual(result.sha256, A_REAL_HASH);
  assert.match(result.refusal ?? "", /is not the .* it was requested under/);
  assert.equal(result.body, undefined, "a refused asset never hands back bytes");
});

test("a non-200 is a refusal naming the status, never an exception that ends a 900-row restore", async () => {
  const result = await fetchAssetFromRemote(A_REAL_HASH, ".jpg", {
    fetchImpl: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(result.refusal ?? "", /HTTP 404/);
});

test("a transport failure is a per-row refusal carrying what was seen", async () => {
  const result = await fetchAssetFromRemote(A_REAL_HASH, ".jpg", {
    fetchImpl: (async () => {
      throw new Error("ENOTFOUND raw.githubusercontent.com");
    }) as unknown as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.match(result.refusal ?? "", /ENOTFOUND/);
});

test("the restore path in scripts/assets.mts walks the remote and counts it separately", () => {
  const source = readFileSync(join(ROOT, "scripts", "assets.mts"), "utf8");
  assert.match(source, /fetchAssetFromRemote/, "restore must be able to reach the public store");
  assert.match(source, /fromRemote/, "the remote count is reported on its own line");
  assert.match(
    source,
    /--no-remote/,
    "a purely local restore stays expressible, and is NAMED in the output when taken",
  );
  /* A row the remote could not supply is a CANNOT RUN for that row, never a decision to serve nothing. */
  assert.match(source, /never a decision to serve nothing/);
});
