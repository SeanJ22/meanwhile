import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_ASK_ESSENTIAL_FAMILIES, preloadNativeAskSources } from "../lib/ask/native-source-preload.ts";
import type { ReaderManifest } from "../lib/meetings/edge-artifacts.ts";

test("native cold initialization starts canonical source reads without waiting for the Ask engine", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const edgeDone = new Promise<void>(resolve => { release = resolve; });
  const manifest = { authorityArtifacts: {} } as ReaderManifest;
  const pending = preloadNativeAskSources(async () => ({
    readReaderManifest: async () => { calls.push("manifest"); return manifest; },
    ensureReaderAuthorityEdge: async (received, store, families) => {
      calls.push("authority");
      assert.equal(received, manifest);
      assert.equal(store, undefined, "reuse the canonical read store");
      assert.deepEqual(families, NATIVE_ASK_ESSENTIAL_FAMILIES);
      assert.ok(!families.includes("federal-votes"), "unrelated deferred families are not added");
      await edgeDone;
    },
  }));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, ["manifest", "authority"]);
  release(); assert.equal(await pending, "ATTEMPTED");
});

test("a missing or failing native prefetch never substitutes an answer or blocks the normal route", async () => {
  for (const missing of [null, {} as ReaderManifest]) {
    const result = await preloadNativeAskSources(async () => ({
      readReaderManifest: async () => missing,
      ensureReaderAuthorityEdge: async () => assert.fail("no artifact authority was supplied"),
    }));
    assert.equal(result, "UNAVAILABLE");
  }
  for (const failureAt of ["load", "manifest", "authority"]) {
    const calls: string[] = [];
    const result = await preloadNativeAskSources(async () => {
      calls.push("load"); if (failureAt === "load") throw Error("load unavailable");
      return {
        readReaderManifest: async () => { calls.push("manifest"); if (failureAt === "manifest") throw Error("manifest unavailable"); return { authorityArtifacts: {} } as ReaderManifest; },
        ensureReaderAuthorityEdge: async () => { calls.push("authority"); throw Error("artifact unavailable"); },
      };
    });
    assert.equal(result, "FAILED");
    assert.equal(calls.filter(value => value === failureAt).length, 1, "no automatic retry loop");
  }
});
