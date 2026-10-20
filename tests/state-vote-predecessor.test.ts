import { votePagesIssue } from "../lib/state-rollcalls/vote-page-model.ts";
import { parsePluralBulkSession } from "./helpers/state-vote-parsers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/changes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createVoteRefreshSink } from "../lib/state-rollcalls/vote-predecessor.ts";
import { readVotePages } from "../lib/state-rollcalls/vote-pages.ts";

import { pluralVotesCandidate, readPluralVotesProjection, type PluralVotesProjection } from "../lib/sources/plural/votes.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

const root = new URL("./fixtures/state-votes/openstates/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const sample = manifest.states.find((row: { state: string }) => row.state === "WA");
const bytes = await readFile(new URL(sample.fixtureArchive, root));
const source = { requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl, retrievedAt: manifest.capturedAt, body: "",
  sha256: createHash("sha256").update(bytes).digest("hex") };
const vote = (await parsePluralBulkSession("WA", sample.session, bytes, source)).votes[0];

async function setup(failure?: "proof" | "hash") {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const projection: PluralVotesProjection = { formatVersion: 1, state: "WA", rollCalls: Array.from({ length: 80 }, (_, index) => ({ ...vote,
    id: `ocd-vote/00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) };
  const candidate = pluralVotesCandidate({ projection, acquired: [source], held: [], checkedAt: source.retrievedAt });
  const published = await processRegisteredRoutineCandidate(store, "openstates-votes-wa", candidate, source.retrievedAt);
  assert.ok(published.promoted);
  const encoded = partitionCivicPayload(projection), parts = new Map(encoded.parts.map(part => [part.hash, part.payload]));
  let requests = 0;
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(statement => {
    requests++;
    if (statement.text.includes("FROM civic_data_promotions")) {
      assert.deepEqual(statement.params, ["US-WA:openstates-votes:v1", "plural-openstates-votes"]);
      return [{ payload: encoded.value, version_id: candidate.id, receipt: published.promoted!.receipt,
        normalized_hash: failure === "hash" ? "0".repeat(64) : canonicalCivicDataHash(projection), proof_valid: failure !== "proof" }];
    }
    assert.match(statement.text, /WHERE hash=ANY\(\$1::text\[\]\)/);
    return (statement.params[0] as string[]).map(hash => ({ hash, payload: parts.get(hash) }));
  }));
  return { input: { state: "WA", sourceId: "plural-openstates-votes", scope: "US-WA:openstates-votes:v1", civicStore: store, vault, query,
    readPrior: () => readPluralVotesProjection("WA", { store, bypassCache: true, now: source.retrievedAt }) }, vault, projection, candidate, requests: () => requests };
}

test("a partitioned legacy source streams into member pages and keeps its exact authenticated facts", async () => {
  const h = await setup(), result = await createVoteRefreshSink(h.input);
  try {
    assert.equal(result.baseVersionId, h.candidate.id);
    const projection = await result.sink.snapshot();
    assert.equal(votePagesIssue(projection), null);
    assert.equal(projection.rollCalls.length, h.projection.rollCalls.length);
    assert.ok(h.requests() > 1);
    const rows = await readVotePages(h.vault, projection, vote.positions[0].personId);
    assert.equal(rows.length, h.projection.rollCalls.length);
    assert.equal(rows[0].motion, vote.motion);
  } finally { await result.sink.close(); }
});

for (const failure of ["proof", "hash"] as const) test(`legacy ${failure} corruption cannot produce a reader publication`, async () => {
  const h = await setup(failure);
  await assert.rejects(createVoteRefreshSink(h.input), failure === "proof" ? /VOTE_PREDECESSOR_PROOF_INVALID/ : /VOTE_PREDECESSOR_HASH_MISMATCH/);
});
