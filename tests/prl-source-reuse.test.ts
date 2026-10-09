import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zip } from "../scripts/xlsx.mjs";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { openPrlSource } from "../lib/sources/prl/fetch-source.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { ingestDataset } from "../lib/sources/prl/ingest.ts";

test("a conditional source confirmation reuses saved complete bytes and original observation", async () => {
  const root = await mkdtemp(join(tmpdir(), "prl-source-test-"));
  try {
    const archive = new LocalFileArchiveStore(root), dataset = requiredPrlDataset("press-releases");
    const body = zip([{ name: "statements.json", data: Buffer.from('[{"id":1,"bioguide_id":"B000944","date":"2026-09-01","text":"Statement"}]') }], "2026-10-01");
    let requests = 0;
    const fetcher = (async (_url: string | URL | Request, options?: RequestInit) => {
      requests++;
      if (requests > 1) {
        assert.equal(new Headers(options?.headers).get("if-none-match"), '"release-1"');
        return new Response(null, { status: 304 });
      }
      return new Response(body, { headers: { etag: '"release-1"', "content-length": String(body.length) } });
    }) as typeof fetch;
    const first = await ingestDataset({ dataset, archive, now: Date.now(), priorReceipt: null, open: () => openPrlSource(dataset, fetcher, archive) });
    const reused = await ingestDataset({ dataset, archive, now: Date.now(), priorReceipt: first, open: () => openPrlSource(dataset, fetcher, archive, first.sourceSha256) });
    assert.equal(reused.rowsWritten, 0); assert.equal(reused.fetchedAt, first.fetchedAt);
    const replay = await ingestDataset({ dataset, archive, now: Date.now(), priorReceipt: { ...first, parserVersion: "old-parser" }, open: () => openPrlSource(dataset, fetcher, archive) });
    assert.equal(replay.rowsWritten, 1); assert.equal(replay.fetchedAt, first.fetchedAt);
    assert.equal(replay.sourceSha256, first.sourceSha256);
    const identical = await ingestDataset({ dataset, archive, now: Date.now(), priorReceipt: first,
      open: () => openPrlSource(dataset, (async () => new Response(body)) as typeof fetch, archive, first.sourceSha256) });
    assert.equal(identical.rowsWritten, 0, "identical HTTP 200 content also reuses the validated release");
    assert.equal(identical.fetchedAt, first.fetchedAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an incomplete download cannot become held source authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "prl-source-test-"));
  try {
    const archive = new LocalFileArchiveStore(root), dataset = requiredPrlDataset("press-releases");
    const fetcher = (async () => new Response("cut off", { headers: { "content-length": "100" } })) as typeof fetch;
    await assert.rejects(openPrlSource(dataset, fetcher, archive), /TRUNCATED/);
    assert.equal(await archive.get(`${dataset.id}/source.json`), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
