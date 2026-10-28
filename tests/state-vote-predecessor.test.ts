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
import { PGlite } from "@electric-sql/pglite";
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
  const db = new PGlite();
  await db.exec(`CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,validation_receipt jsonb,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,promoted_version_id text,last_known_good_version_id text,state text,acquisition_succeeded boolean,candidate jsonb,normalized_hash text,validation_receipt jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    ALTER TABLE civic_data_candidates ADD COLUMN read_model_fingerprint text;
    ALTER TABLE civic_data_promotions ADD COLUMN payload_fingerprint text;`);
  let encoded = partitionCivicPayload(projection);
  const versionId=candidate.id,receipt=published.promoted!.receipt,fetched:string[]=[];
  const writeParts = async () => { for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]); };
  await writeParts();
  const normalizedHash=failure === "hash" ? "0".repeat(64) : canonicalCivicDataHash(projection);
  const encodedCandidate = () => ({normalization:{succeeded:true,normalizedHash:canonicalCivicDataHash(projection)},readModel:encoded.value});
  await db.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,$1,$1,'PROMOTED',$5,$6::jsonb,$7,$8::jsonb)",
    [versionId,"plural-openstates-votes","STATE_ROLL_CALL","US-WA:openstates-votes:v1",failure!=="proof",JSON.stringify({...encodedCandidate(),normalization:{succeeded:true,normalizedHash}}),normalizedHash,JSON.stringify(receipt)]);
  await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$3,$4,$5::jsonb,$6::jsonb)",
    ["STATE_ROLL_CALL","US-WA:openstates-votes:v1",versionId,"plural-openstates-votes",JSON.stringify(receipt),JSON.stringify(encoded.value)]);
  let requests = 0;
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => {
    requests++;
    if (statement.text.includes("FROM civic_data_promotions")) assert.deepEqual(statement.params.slice(0, 2), ["US-WA:openstates-votes:v1", "plural-openstates-votes"]);
    else {
      assert.match(statement.text, /WHERE hash=ANY\(\$1::text\[\]\)/);
      assert.ok((statement.params[0] as string[]).length <= 512,"part reads and dependency checks stay bounded");
    }
    const result=await db.query<Record<string,unknown>>(statement.text,[...statement.params]);
    if (statement.text.startsWith("SELECT hash,payload")) for (const row of result.rows) fetched.push(String(row.hash));
    return result.rows;
  }));
  const copies=new Map<string,string>(), cache=()=>new CivicReadCache({read:async key=>copies.get(key)??null,write:async(key,value)=>{copies.set(key,value);}});
  return { input: { state: "WA", sourceId: "plural-openstates-votes", scope: "US-WA:openstates-votes:v1", civicStore: store, vault, query,cache:cache(),
    readPrior: () => readPluralVotesProjection("WA", { store,  now: source.retrievedAt }) }, vault, projection, candidate, cache, requests: () => requests, fetched,close:()=>db.close(),
    corruptPart:async()=>{
      const part=encoded.parts.find(part=>JSON.stringify(part.payload).includes(vote.motion));assert.ok(part);
      const changed=JSON.parse(JSON.stringify(part.payload).split(vote.motion).join("Corrupt source motion"));
      await db.query("UPDATE civic_data_payload_parts SET payload=$2::jsonb WHERE hash=$1",[part.hash,JSON.stringify(changed)]);
      return part.hash;
    },
    invalidateProof:()=>db.query("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id=$1",[versionId]),
    change:async()=>{projection={...projection,rollCalls:projection.rollCalls.map((row,index)=>index===0?{...row,motion:"Corrected source motion"}:row)};
      encoded=partitionCivicPayload(projection);await writeParts();
      await db.query("UPDATE civic_data_candidates SET candidate=$2::jsonb,normalized_hash=$3 WHERE id=$1",[versionId,JSON.stringify(encodedCandidate()),canonicalCivicDataHash(projection)]);
      await db.query("UPDATE civic_data_promotions SET payload=$2::jsonb WHERE current_version_id=$1",[versionId,JSON.stringify(encoded.value)]);
    } };

}

test("a partitioned legacy source streams into member pages and keeps its exact authenticated facts", async t => {
  const h = await setup();t.after(()=>h.close());const result = await createVoteRefreshSink(h.input);
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

for (const failure of ["proof", "hash"] as const) test(`legacy ${failure} corruption cannot produce a reader publication`, async t => {
  const h = await setup(failure);t.after(()=>h.close());
  await assert.rejects(createVoteRefreshSink(h.input), failure === "proof" ? /VOTE_PREDECESSOR_PROOF_INVALID/ : /VOTE_PREDECESSOR_HASH_MISMATCH/);
});

test("a fresh vote job checks native versions and reads only changed parts after a same-ID source update",async t=>{
  const h=await setup();t.after(()=>h.close());const cache=h.cache;
  const first=await createVoteRefreshSink({...h.input,cache:cache()});
  const before=await first.sink.snapshot();await first.sink.close();
  const requests=h.requests(),old=new Set(h.fetched);h.fetched.length=0;
  const second=await createVoteRefreshSink({...h.input,cache:cache(),readPrior:async()=>{throw Error("no second projection read");}});
  assert.deepEqual(await second.sink.snapshot(),before);await second.sink.close();
  assert.ok(h.requests()-requests>=2,"the pointer and every dependent part version are checked");assert.deepEqual(h.fetched,[]);
  await h.change();
  const changed=await createVoteRefreshSink({...h.input,cache:cache()});
  const after=await changed.sink.snapshot();await changed.sink.close();
  assert.equal(after.rollCalls[0].motion,"Corrected source motion");assert.equal(after.rollCalls.length,before.rollCalls.length);
  assert.ok(h.fetched.length>0);assert.ok(h.fetched.every(hash=>!old.has(hash)),"unchanged history parts do not cross Neon again");
});

test("a same-key part mutation invalidates the derived predecessor copy on the next read",async t=>{
  const h=await setup();t.after(()=>h.close());
  const first=await createVoteRefreshSink(h.input);await first.sink.close();h.fetched.length=0;
  const changedHash=await h.corruptPart();
  await assert.rejects(createVoteRefreshSink({...h.input,cache:h.cache()}),/VOTE_PREDECESSOR_HASH_MISMATCH/);
  assert.deepEqual(h.fetched,[changedHash],"only the part whose physical row version changed crosses again");
});

test("a changed publication proof is rejected even when its candidate ID stays the same",async t=>{
  const h=await setup();t.after(()=>h.close());
  const first=await createVoteRefreshSink(h.input);await first.sink.close();h.fetched.length=0;
  await h.invalidateProof();
  await assert.rejects(createVoteRefreshSink({...h.input,cache:h.cache()}),/VOTE_PREDECESSOR_PROOF_INVALID/);
  assert.deepEqual(h.fetched,[]);
});
