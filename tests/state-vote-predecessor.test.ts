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
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";

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
  let projection: PluralVotesProjection = { formatVersion: 1, state: "WA", rollCalls: Array.from({ length: 80 }, (_, index) => ({ ...vote,
    id: `ocd-vote/00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) };
  const candidate = pluralVotesCandidate({ projection, acquired: [source], held: [], checkedAt: source.retrievedAt });
  const published = await processRegisteredRoutineCandidate(store, "openstates-votes-wa", candidate, source.retrievedAt);
  assert.ok(published.promoted);
  let encoded = partitionCivicPayload(projection), versionId=candidate.id;
  const parts = new Map(encoded.parts.map(part => [part.hash, part.payload])), fetched:string[]=[];
  let requests = 0;
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(statement => {
    requests++;
    if (statement.text.includes("FROM civic_data_promotions")) {
      assert.deepEqual(statement.params.slice(0, 2), ["US-WA:openstates-votes:v1", "plural-openstates-votes"]);
      const unchanged=statement.params[2]===`${versionId}:${canonicalCivicDataHash(projection)}`;
      return [{ payload: unchanged ? null : encoded.value, unchanged, version_id: versionId, receipt: {...published.promoted!.receipt,candidateId:versionId},
        normalized_hash: failure === "hash" ? "0".repeat(64) : canonicalCivicDataHash(projection), proof_valid: failure !== "proof" }];
    }
    assert.match(statement.text, /WHERE hash=ANY\(\$1::text\[\]\)/);
    return (statement.params[0] as string[]).map(hash => {fetched.push(hash);return { hash, payload: parts.get(hash) };});
  }));
  return { input: { state: "WA", sourceId: "plural-openstates-votes", scope: "US-WA:openstates-votes:v1", civicStore: store, vault, query,
    readPrior: () => readPluralVotesProjection("WA", { store, bypassCache: true, now: source.retrievedAt }) }, vault, projection, candidate, requests: () => requests, fetched,
    change:()=>{projection={...projection,rollCalls:projection.rollCalls.map((row,index)=>index===0?{...row,motion:"Corrected source motion"}:row)};
      encoded=partitionCivicPayload(projection);for(const part of encoded.parts)parts.set(part.hash,part.payload);versionId="cv-changed-source";} };
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

test("a fresh vote job reuses its verified predecessor and reads only changed immutable parts after a source update",async()=>{
  const h=await setup(),held=new Map<string,string>();
  const cache=()=>new CivicReadCache({read:async key=>held.get(key)??null,write:async(key,value)=>{held.set(key,value);}});
  const first=await createVoteRefreshSink({...h.input,cache:cache()});
  const before=await first.sink.snapshot();await first.sink.close();
  const requests=h.requests(),old=new Set(h.fetched);h.fetched.length=0;
  const second=await createVoteRefreshSink({...h.input,cache:cache(),readPrior:async()=>{throw Error("no second projection read");}});
  assert.deepEqual(await second.sink.snapshot(),before);await second.sink.close();
  assert.equal(h.requests()-requests,1);assert.deepEqual(h.fetched,[]);
  h.change();
  const changed=await createVoteRefreshSink({...h.input,cache:cache()});
  const after=await changed.sink.snapshot();await changed.sink.close();
  assert.equal(after.rollCalls[0].motion,"Corrected source motion");assert.equal(after.rollCalls.length,before.rollCalls.length);
  assert.ok(h.fetched.length>0);assert.ok(h.fetched.every(hash=>!old.has(hash)),"unchanged history parts do not cross Neon again");
});
