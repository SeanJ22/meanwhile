import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readStateReaderPromotion } from "../lib/civic-data/state-reader-store.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";

const recordClass = "REGISTRY_RUNTIME_BINDING", scope = "US-AZ:reader-registry-runtime", key = `${recordClass}:${scope}`;
test("keyed state hydration imports cold without a fixture preload", () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module",
    "-e", 'await import("./lib/civic-data/state-reader-store.ts")'], { cwd: process.cwd(), stdio: "pipe" });
});
function row(payload: unknown) {
  return { proof_valid: true, confirmation: null, parts: {} as Record<string, unknown>, roots: {
    projection: { key,recordClass,scope,sourceId:"registry-reviewed-bindings",versionId:"az-v1",lastKnownGoodVersionId:"az-v1",promotedAt:"2026-10-16T10:00:00Z",payload,receipt:{} },
    candidate: { candidate:{ id:"az-v1",normalization:{ normalizedHash:canonicalCivicDataHash(payload) },retrieval:{ retrievedAt:"2026-10-16T09:00:00Z" },temporal:{} } },
  } };
}

test("state hydration uses one exact keyed query and preserves inline object identity", async () => {
  const payload = { registry:{ bodies:[{id:"az-body",name:"Held body"}] } }, source = row(payload);
  let calls = 0;
  const result = await readStateReaderPromotion(async (sql, params) => {
    calls++;
    assert.deepEqual(params,[key]);
    assert.match(sql,/WHERE p\.key=\$1/);
    assert.doesNotMatch(sql,/reader_(?:place|inventory|payload_value)/);
    return [source];
  },recordClass,scope);
  assert.equal(calls,1);
  assert.equal(result?.projection.payload,payload);
  assert.equal(result?.candidate.receipt,result?.projection.receipt);
});

test("nested encoded strings and interleaved arrays decode without cloning their records", async () => {
  const payload = { records:Array.from({length:1_200},(_,id)=>({id,state:id%2?"AZ":"NJ",text:"Held source text. ".repeat(20)})),
    longText:"🗳️ State document. ".repeat(4_000) };
  const encoded = partitionCivicPayload(payload), source = row(payload);
  source.roots.projection.payload = encoded.value;
  source.parts = Object.fromEntries(encoded.parts.map(part=>[part.hash,part.payload]));
  const retainedRecord = encoded.parts.flatMap(part=>Array.isArray(part.payload)?part.payload:[]).find(value=>value?.id===17);
  assert.ok(retainedRecord);
  const result = await readStateReaderPromotion<typeof payload>(async()=>[source],recordClass,scope);
  assert.deepEqual(result?.projection.payload,payload);
  assert.equal(result?.projection.payload.records[17],retainedRecord);
  assert.deepEqual(source.parts,{});
});

test("repeated part references resolve to one record object", async () => {
  const object = { id:"shared-record" }, payload = { left:object,right:object }, source = row(payload);
  source.roots.projection.payload = { left:{$civicPayloadPart:"shared"},right:{$civicPayloadPart:"shared"} };
  source.parts = {shared:{kind:"object",value:object}};
  const result = await readStateReaderPromotion<typeof payload>(async()=>[source],recordClass,scope);
  assert.equal(result?.projection.payload.left,object);
  assert.equal(result?.projection.payload.right,object);
});

test("invalid scopes fail before SQL and a missing exact state remains unrecorded", async () => {
  const query = async()=>{throw new Error("SQL must not run");};
  await assert.rejects(readStateReaderPromotion(query,recordClass,"US:reader-registry-runtime-bindings"),/STATE_READER_SCOPE_INVALID/);
  await assert.rejects(readStateReaderPromotion(query,"BALLOT_CANDIDACY",scope),/STATE_READER_SCOPE_INVALID/);
  let calls=0;
  assert.equal(await readStateReaderPromotion(async()=>{calls++;return [];},recordClass,scope),null);
  assert.equal(calls,1);
});

test("federal directory, optional portraits and registration hydrate by their exact state keys", async () => {
  for (const [recordClass, scope] of [
    ["FEDERAL_DIRECTORY", "US-AZ:current-congress-directory"],
    ["STATE_LEGISLATOR", "US-AZ:people:portraits:v1"],
    ["REGISTRATION", "US-TX:registration:v1"],
  ] as const) {
    const payload = { held: recordClass }, source = row(payload);
    Object.assign(source.roots.projection, { recordClass, scope, key: `${recordClass}:${scope}` });
    const read = await readStateReaderPromotion(async (_sql, params) => {
      assert.deepEqual(params, [`${recordClass}:${scope}`]);
      return [source];
    }, recordClass, scope);
    assert.deepEqual(read?.projection.payload, payload);
  }
  const query = async () => { throw new Error("SQL must not run"); };
  for (const scope of ["US:current-congress-directory", "US-XX:current-congress-directory", "US-AZ:people:portraits:v1"])
    await assert.rejects(readStateReaderPromotion(query, "FEDERAL_DIRECTORY", scope), /STATE_READER_SCOPE_INVALID/);
});

test("changed proof, missing parts, cycles and changed part contents cannot serve", async () => {
  const proof = row({id:"held"}); proof.proof_valid=false;
  await assert.rejects(readStateReaderPromotion(async()=>[proof],recordClass,scope),/STATE_READER_PUBLISHED_PROOF_INVALID/);
  const missing = row({id:"held"}); missing.roots.projection.payload={$civicPayloadPart:"missing"};
  await assert.rejects(readStateReaderPromotion(async()=>[missing],recordClass,scope),/STATE_READER_PART_MISSING/);
  const cycle = row({id:"held"}); cycle.roots.projection.payload={$civicPayloadPart:"cycle"};cycle.parts={cycle:{$civicPayloadPart:"cycle"}};
  await assert.rejects(readStateReaderPromotion(async()=>[cycle],recordClass,scope),/STATE_READER_PART_CYCLE/);
  const tampered = row({id:"held"}); tampered.roots.projection.payload={$civicPayloadPart:"changed"};tampered.parts={changed:{id:"different"}};
  await assert.rejects(readStateReaderPromotion(async()=>[tampered],recordClass,scope),/STATE_READER_PAYLOAD_HASH_MISMATCH/);
});
