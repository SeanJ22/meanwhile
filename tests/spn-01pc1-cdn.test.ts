import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { answerPath, easternDay, type assembleAnswer } from "../lib/reader/answer.ts";
import { serveAnswer, serveZip3 } from "../lib/reader/answer-serve.ts";
import { READER_ZIP3_TAG, zip3Key, type Zip3File, type ZipRow } from "../lib/reader/zip3.ts";
import { fakeCdn } from "./helpers/cdn.ts";

const row = (key: string): ZipRow => ({ states: ["AZ"], point: [-110.9, 32.2], key, day: easternDay(new Date()), ids: [], partial: [], fringe: [], districts: [] });

test("SPN-01PC1: behind a CDN that keeps by address, 1,000 visits over 30 neighbouring ZIPs with pages changing in between assemble each address once", async () => {
  const root = mkdtempSync(join(tmpdir(), "pc1-cdn-")), store = new LocalFileArtifactStore(root);
  try {
    const zips = Array.from({ length: 30 }, (_, n) => String(85701 + n)), keys = new Map<string, string>();
    let counter = 0;
    const newKey = () => (++counter).toString(16).padStart(12, "0");
    for (const zip of zips) keys.set(zip, newKey());
    const publishAll = async () => {
      const held = await store.readJsonPointer(zip3Key("857"));
      await store.writeJsonPointer<Zip3File>(zip3Key("857"), { v: 1, zips: Object.fromEntries(zips.map(zip => [zip, row(keys.get(zip)!)])) }, held?.etag ?? null);
    };
    await publishAll();
    let now = 0, assemblies = 0, zip3Runs = 0;
    const assembled = new Map<string, number>();
    const assemble = (async (_store: unknown, zip: string, found: ZipRow) => {
      assemblies++; assembled.set(`${zip}/${found.key}`, (assembled.get(`${zip}/${found.key}`) ?? 0) + 1); return { zip, key: found.key };
    }) as unknown as typeof assembleAnswer;
    const accepts = new Request("https://example.test/a", { headers: { "accept-encoding": "gzip, br" } });
    const cdn = fakeCdn(async url => {
      const [area, first, second] = url.pathname.split("/").slice(2);
      if (area === "reader") { zip3Runs++; return serveZip3(second!.replace(".json", ""), store); }
      return serveAnswer(accepts, first!, second!, store, assemble);
    }, () => now);
    // A small deterministic generator: the same visits every run.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const refused = new Set<string>(), requested = new Set<string>();
    // The fifth change is cleared late: until the ZIP file of the prefix ages out, readers are sent from a stale address to the current one.
    const changes = new Map([[200, true], [400, true], [520, false], [700, true], [850, true]]);
    let redirected = 0;
    for (let visit = 0; visit < 1000; visit++) {
      now += Math.floor(random() * 40_000);
      const purge = changes.get(visit);
      if (purge !== undefined) {
        for (let n = 0; n < 6; n++) keys.set(zips[Math.floor(random() * zips.length)]!, newKey());
        // The busiest ZIPs are among those that changed, so readers of the late-cleared file meet the stale address.
        if (!purge) { for (const zip of zips.slice(0, 3)) keys.set(zip, newKey()); await cdn.get("/api/reader/zip3/857.json"); }
        await publishAll();
        if (purge) cdn.purge(READER_ZIP3_TAG("857"));
      }
      const zip = purge === false ? zips[0]! : zips[Math.floor(random() ** 2 * zips.length)]!;
      const file = await (await cdn.get("/api/reader/zip3/857.json")).json() as Zip3File;
      if (file.zips[zip]!.key !== keys.get(zip)) redirected++;
      const response = await cdn.get(answerPath(zip, file.zips[zip]!.key));
      if (response.status !== 200) refused.add(zip);
      else { const made = JSON.parse(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString()) as { zip: string; key: string }; requested.add(`${made.zip}/${made.key}`); assert.ok(made.key === keys.get(zip) || made.key === file.zips[zip]!.key, "a reader is given the answer the file they read names, or the current one"); }
    }
    console.log(`1000 visits: ${assemblies} assemblies for ${requested.size} addresses, ${zip3Runs} ZIP-file runs, ${cdn.runs.origin} origin runs in all, ${cdn.runs.hits} answered by the CDN, ${redirected} read a stale ZIP file`);
    assert.equal(refused.size, 0);
    assert.ok(redirected > 0, "the late-cleared change left some readers with the stale address for a moment");
    assert.equal(assemblies, requested.size, "one assembly for each address asked for");
    assert.ok([...assembled.values()].every(count => count === 1), "no address is assembled twice");
    assert.ok(assemblies < 100, `${assemblies} assemblies for 1,000 visits`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
