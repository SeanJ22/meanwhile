import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { closeAnswerWarm, WARM_PER_HOUR, WARM_PER_TURN, warmAnswersTurn } from "../lib/reader/answer-warm.ts";
import { zip3Key, type Zip3File, type ZipRow } from "../lib/reader/zip3.ts";

const row = (key: string): ZipRow => ({ states: ["AZ"], point: [-110.9, 32.2], key, ids: [], partial: [], fringe: [], districts: [] });

test("SPN-01PC1: the busiest ZIPs' new answers are asked for once, a few at a time, within the hour's cap, and again when their key moves", async () => {
  const root = mkdtempSync(join(tmpdir(), "pc1-warm-")), store = new LocalFileArtifactStore(root);
  try {
    const zips = Array.from({ length: 199 }, (_, n) => String(85001 + n)), keys = new Map(zips.map((zip, n) => [zip, String(n).padStart(12, "0")]));
    const write = async () => {
      const held = await store.readJsonPointer(zip3Key("850")), held2 = await store.readJsonPointer(zip3Key("851"));
      await store.writeJsonPointer<Zip3File>(zip3Key("850"), { v: 1, zips: Object.fromEntries(zips.filter(zip => zip.startsWith("850")).map(zip => [zip, row(keys.get(zip)!)])) }, held?.etag ?? null);
      await store.writeJsonPointer<Zip3File>(zip3Key("851"), { v: 1, zips: Object.fromEntries(zips.filter(zip => zip.startsWith("851")).map(zip => [zip, row(keys.get(zip)!)])) }, held2?.etag ?? null);
    };
    await write();
    let now = Date.UTC(2026, 10, 9, 5), listed = 0;
    const asked: string[] = [];
    const deps = { store, origin: "https://example.test", now: () => now,
      facts: (async () => { listed++; return zips.map(zip => ({ zip })); }) as never,
      fetch: (async (url: URL) => { asked.push(url.pathname); return new Response("{}"); }) as unknown as typeof fetch };
    closeAnswerWarm();
    assert.equal(await warmAnswersTurn(deps), WARM_PER_TURN, "a few at a time");
    assert.deepEqual(asked, zips.slice(0, WARM_PER_TURN).map(zip => `/api/answer/${zip}/${keys.get(zip)}`), "the busiest first, at their current address");
    while (await warmAnswersTurn(deps)) now += 10_000;
    assert.equal(asked.length, WARM_PER_HOUR, "no more than the hour's cap, however many are due");
    now += 3_600_000;
    while (await warmAnswersTurn(deps)) now += 10_000;
    assert.equal(asked.length, 199, "the next hour finishes the list");
    assert.equal(new Set(asked).size, 199, "each answer once");
    // Nothing moved: nothing is asked, and the store is not looked at on every turn.
    now += 10_000;
    assert.equal(await warmAnswersTurn(deps), 0);
    // A page changes: only the ZIP whose key moved is asked for again.
    keys.set("85005", "ffffffffffff"); await write(); now += 120_000;
    assert.equal(await warmAnswersTurn(deps), 1);
    assert.equal(asked.at(-1), "/api/answer/85005/ffffffffffff");
    assert.ok(listed <= 3, "the list of busy ZIPs is read now and then, not on every turn");
  } finally { closeAnswerWarm(); rmSync(root, { recursive: true, force: true }); }
});
