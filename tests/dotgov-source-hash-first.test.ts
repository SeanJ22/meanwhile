import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acquireDotGovSource, refreshDotGov } from "../scripts/fetch-dotgov.mts";
import { DOTGOV_SCOPE } from "../lib/civic-data/dotgov.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const rawText = readFileSync(new URL("./fixtures/dotgov/current-full.csv", import.meta.url), "utf8");
const sha = "a".repeat(40), finalUrl = `https://raw.githubusercontent.com/cisagov/dotgov-data/${sha}/current-full.csv`;
const firstAt = "2026-10-20T12:00:00.000Z", secondAt = "2026-10-20T13:00:00.000Z";

test("DotGov compares complete source bytes before held payload or event-history reads", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await refreshDotGov({ store, readSource: async () => ({ sourceSha: sha, rawText, finalUrl, retrievedAt: firstAt }) });
  assert.ok(first.publication?.outcome.promoted);
  assert.equal(first.publication.candidate.retrieval.rawHashBasis, "SOURCE_CONTENT_V1");
  const head = await store.readSourceHead("DOTGOV_REFERENCE", DOTGOV_SCOPE);
  store.readPromotion = async () => { throw Error("unchanged registry payload read"); };
  store.readCandidate = async () => { throw Error("unchanged registry candidate read"); };
  store.readCandidateProof = async () => { throw Error("unchanged registry history read"); };
  const unchanged = await refreshDotGov({ store, readSource: async () => ({ sourceSha: "b".repeat(40), rawText,
    finalUrl: finalUrl.replace(sha, "b".repeat(40)), retrievedAt: secondAt }) });
  assert.equal(unchanged.publication, null);
  assert.equal(unchanged.confirmation?.head.versionId, head?.versionId);
  assert.equal(unchanged.confirmation?.at, secondAt);
  assert.equal((await store.readSourceHead("DOTGOV_REFERENCE", DOTGOV_SCOPE))?.versionId, head?.versionId);
  await assert.rejects(refreshDotGov({ store, readSource: async () => ({ sourceSha: sha, rawText: "truncated source", finalUrl, retrievedAt: secondAt }) }), /domain|columns/i,
    "changed malformed bytes still follow the existing parser refusal before reading a held body");
});

test("DotGov refuses a partial HTTP source before it can confirm complete source freshness", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => String(url).includes("api.github.com")
    ? new Response(JSON.stringify([{ sha }])) : new Response(rawText, { status: 206 })) as typeof fetch;
  try { await assert.rejects(acquireDotGovSource(), /206/); }
  finally { globalThis.fetch = original; }
});
