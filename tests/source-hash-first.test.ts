import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { confirmSourceHashUnchanged, sourceContentHash, sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { confirmRepeatedStatePeopleInputs, confirmStatePeopleSource, peopleSourceContentHash, publishStatePeople, statePeopleInputDigest } from "../lib/civic-data/state-people-publication.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { PLURAL_PARSER_VERSION } from "../lib/sources/plural/targets.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";

const at = "2026-10-01T00:00:00.000Z", later = "2026-10-01T01:00:00.000Z";
const scope = "US-AZ:openstates-people:v1";
const url = `https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/data/az/legislature/One.yml`;
const body = "id: ocd-person/one\nname: Member One\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\n";
const acquisitions = [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body, retrievedAt: at }];
const roster = { ...normalize(yamlToPeople(body, "az", url, at), new Map(), at, "US-AZ"), currentMembershipComplete: true };

test("source digests ignore observations and archive revisions but retain bytes, selected terms and input changes", () => {
  const archive = (sha: string) => ({ ...acquisitions[0], retrievedAt: sha === "a" ? at : later,
    extractedFrom: { requestedUrl: `https://codeload.github.com/openstates/people/zip/${sha.repeat(40)}`, member: "data/az/legislature/One.yml" } });
  assert.equal(sourceContentHash([archive("a")]), sourceContentHash([archive("b")]));
  assert.notEqual(sourceContentHash([archive("a")]), sourceContentHash([{ ...archive("a"), body: body.replace("Member One", "Member Two") }]));
  assert.equal(peopleSourceContentHash(acquisitions, roster), peopleSourceContentHash(acquisitions.map(row => ({ ...row, retrievedAt: later })), { ...roster, generatedAt: later }));
  assert.notEqual(peopleSourceContentHash(acquisitions, roster), peopleSourceContentHash(acquisitions, { ...roster, officeholders: roster.officeholders.map(row => ({ ...row, termEnd: "2026-10-01" })) }));
  assert.notEqual(peopleSourceContentHash(acquisitions,roster),peopleSourceContentHash(acquisitions,{...roster,currentMembershipComplete:false}));
  assert.notEqual(peopleSourceContentHash(acquisitions,roster),peopleSourceContentHash(acquisitions,roster,{gaps:[{sourceUrl:url,detail:"geography unresolved"}]}));
});

test("resolved parse gaps cannot confirm the old incomplete source from identical bytes",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  assert.ok((await publishStatePeople({store,vault,state:"az",roster,acquisitions,releaseId:"a".repeat(40),now:at,
    gaps:[{sourceUrl:url,detail:"GEOGRAPHY_UNRESOLVED: district evidence remains owed"}]})).outcome.promoted);
  for(const method of ["readCandidate","readCandidatePath","readCandidateField","readPromotion","events"] as const)
    Object.assign(store,{[method]:async()=>{throw new Error(`resolved gap read ${method}`);}});
  assert.equal(await confirmStatePeopleSource({store,state:"az",roster,acquisitions,gaps:[],now:later}),null,
    "changed coverage must publish its resolution rather than retain the old gap");
});

test("an unchanged complete state source confirms using its head and no held payload, metadata or event read", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const first = await publishStatePeople({ store, vault, state: "az", roster, acquisitions, releaseId: "a".repeat(40), now: at });
  assert.ok(first.outcome.promoted, JSON.stringify(first.outcome.candidate.receipt));
  const head = await store.readSourceHead("STATE_LEGISLATOR", scope);
  assert.equal(head?.rawHashBasis, "SOURCE_CONTENT_V1");
  assert.equal(head?.acquisitionComplete,true);
  for (const method of ["readCandidate", "readCandidatePath", "readPromotion", "readPublishedCandidateMetadata", "events", "readPromotionIdentity"] as const)
    Object.assign(store, { [method]: async () => { throw new Error(`unchanged source read ${method}`); } });
  const confirmed = await confirmStatePeopleSource({ store, state: "az", roster: { ...roster, generatedAt: later },
    acquisitions: acquisitions.map(row => ({ ...row, retrievedAt: later })), gaps: [], now: later });
  assert.ok(confirmed);
  assert.deepEqual(sourceHashReceiptFields(confirmed), { candidateId: head!.versionId, acquisitionSucceeded: true, state: "PROMOTED",
    decision: "GOOD", promotedVersion: head!.versionId, lastKnownGoodVersion: head!.versionId, confirmedAt: later });
  assert.equal(await confirmStatePeopleSource({ store, state: "az", roster: { ...roster, currentMembershipComplete: false }, acquisitions, now: later }), null);
  const rawHash = peopleSourceContentHash(acquisitions, roster);
  const input = { store, sourceId: "plural-openstates", recordClass: "STATE_LEGISLATOR" as const, scope, parserVersion: PLURAL_PARSER_VERSION,
    rawHash, now: later, complete: true, retrieval: { requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash, retrievedAt: later } };
  assert.equal(await confirmSourceHashUnchanged({ ...input, parserVersion: "repaired-parser" }), null);
  assert.equal(await confirmSourceHashUnchanged({ ...input, rawHash: "f".repeat(64) }), null);
  assert.equal((await store.confirmUnchanged!({ sourceId: input.sourceId, recordClass: input.recordClass, scope,
    parserVersion: "repaired-parser", pointerVersionId: head!.versionId, readModelHash: head!.normalizedHash!,
    basis: "RAW_HASH_UNCHANGED", retrieval: input.retrieval }, later)).kind, "HASH_DIFFERS");
});

test("the real source-head selector and unchanged event rule compare current source bytes and parser atomically", async () => {
  await withMigratedRoutineStore("openstates-people-az", async (store, vault, pg) => {
    const first = await publishStatePeople({ store, vault, state: "az", roster, acquisitions, releaseId: "a".repeat(40), now: at });
    assert.ok(first.outcome.promoted, JSON.stringify(first.outcome.candidate.receipt));
    const head = await store.readSourceHead("STATE_LEGISLATOR", scope);
    assert.equal(head?.rawHashBasis, "SOURCE_CONTENT_V1");
    for (const method of ["readCandidate", "readCandidatePath", "readPromotion", "readPublishedCandidateMetadata", "events"] as const)
      Object.assign(store, { [method]: async () => { throw new Error(`unchanged source read ${method}`); } });
    const confirmed = await confirmStatePeopleSource({ store, state: "az", roster, acquisitions, now: new Date().toISOString() });
    assert.ok(confirmed);
    const rows = (await pg.query<{ detail: string }>("SELECT detail FROM civic_data_candidate_events WHERE candidate_id=$1 ORDER BY sequence DESC LIMIT 1", [head!.versionId])).rows;
    assert.match(rows[0].detail, /RAW_HASH_UNCHANGED/);
    const bad = { sourceId: head!.sourceId, recordClass: head!.recordClass, scope, parserVersion: head!.parserVersion,
      pointerVersionId: head!.versionId, readModelHash: head!.normalizedHash!, basis: "RAW_HASH_UNCHANGED" as const,
      retrieval: { requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash: "f".repeat(64), retrievedAt: at } };
    assert.equal((await store.confirmUnchanged!(bad, new Date().toISOString())).kind, "HASH_DIFFERS");
  });
});

test("unchanged source receipts retain only a fingerprint-filed source reference", async () => {
  await withMigratedRoutineStore("openstates-people-az", async (store, vault, pg) => {
    const first = await publishStatePeople({ store, vault, state: "az", roster, acquisitions, releaseId: "a".repeat(40), now: at });
    assert.ok(first.outcome.promoted);
    const head = (await store.readSourceHead("STATE_LEGISLATOR", scope))!;
    const bytes = Buffer.from("source response retained for downstream work");
    const rawHash = createHash("sha256").update(bytes).digest("hex");
    const checkedAt = new Date().toISOString();
    const response = { source: "test", requestedUrl: url, finalUrl: url, httpStatus: 200, rawHash,
      byteCount: bytes.length, contentType: "text/plain", retrievedAt: checkedAt, base64: bytes.toString("base64") };
    const result = await store.confirmUnchanged!({ sourceId: head.sourceId, recordClass: head.recordClass, scope,
      parserVersion: head.parserVersion, pointerVersionId: head.versionId, readModelHash: head.normalizedHash!,
      basis: "RAW_HASH_UNCHANGED", retrieval: { requestedUrl: url, finalUrl: url, httpStatus: 200,
        rawHash: head.rawHash!, retrievedAt: checkedAt }, retainedSourceResponses: [response] }, checkedAt);
    assert.equal(result.kind, "CONFIRMED");
    const rows = (await pg.query<{detail:string}>("SELECT detail FROM civic_data_candidate_events WHERE candidate_id=$1 AND detail LIKE 'UNCHANGED_CONFIRMATION_SOURCES_V1 %'", [head.versionId])).rows;
    assert.equal(rows.length, 1);
    assert.doesNotMatch(rows[0].detail, /base64|source response retained/);
    const saved = JSON.parse(rows[0].detail.slice("UNCHANGED_CONFIRMATION_SOURCES_V1 ".length)).retainedSourceResponses[0];
    assert.match(saved.vaultKey, new RegExp(`${rawHash}$`));
    assert.deepEqual(Buffer.from((await vault.get(saved.vaultKey))!.bytes), bytes);
  });
});

test("repeated partial inputs skip held people without refreshing unread facts", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const input = {store,vault,state:"az",roster:{...roster,currentMembershipComplete:false},acquisitions,
    releaseId:"a".repeat(40),gaps:[{sourceUrl:url,detail:"SOURCE_PARTIAL: another publisher is unavailable"}],now:at};
  const first=await publishStatePeople(input);assert.ok(first.outcome.promoted);
  assert.equal((await store.readSourceHead("STATE_LEGISLATOR",scope))?.acquisitionComplete,false);
  const readPath=store.readCandidatePath.bind(store),metadataReads:string[]=[];
  store.readCandidatePath=async<T>(id:string,path:readonly string[])=>{
    const key=path.join(".");
    assert.ok(["normalizedPayload.sourceInputDigest","retrieval"].includes(key),`partial confirmation attempted held ${key}`);
    metadataReads.push(key);return readPath<T>(id,path);
  };
  for(const method of ["readCandidate","readCandidateField","readPromotion","readPublishedCandidateMetadata","events"] as const)
    Object.assign(store,{[method]:async()=>{throw new Error(`partial confirmation read ${method}`);}});
  assert.ok(await confirmRepeatedStatePeopleInputs({...input,now:later}));
  assert.deepEqual(metadataReads,["normalizedPayload.sourceInputDigest","retrieval"],"the first unchanged pass reads stored hashes and retrieval metadata only");
  const pointer=await store.readPromotionIdentity("STATE_LEGISLATOR",scope);
  assert.equal(pointer?.latestConfirmation?.inputDigest,statePeopleInputDigest(input));
  const checkedAt="2026-10-01T02:00:00.000Z";
  const rechecked={...input,now:checkedAt,roster:{...input.roster,generatedAt:checkedAt},
    acquisitions:input.acquisitions.map(row=>({...row,retrievedAt:checkedAt}))};
  assert.equal(statePeopleInputDigest(rechecked),statePeopleInputDigest(input));
  assert.ok(await confirmRepeatedStatePeopleInputs(rechecked));
  assert.equal(metadataReads.length,2,"subsequent confirmations read no candidate fields at all");
  const latest=await store.readPromotionIdentity("STATE_LEGISLATOR",scope);
  assert.equal(latest?.latestConfirmation?.retrieval.retrievedAt,at,"partial confirmation preserves the original aggregate freshness");
  assert.equal(latest?.latestConfirmation?.observedAt,checkedAt);
  assert.equal(await confirmRepeatedStatePeopleInputs({...rechecked,gaps:[]}),null,"changed parse coverage must be checked normally");
  assert.equal(await confirmRepeatedStatePeopleInputs({...rechecked,acquisitions:rechecked.acquisitions.map(row=>({...row,body:row.body+"# new bytes\n"}))}),null);
});

test("a complete new run cannot confirm an explicitly incomplete held payload solely because its bytes match",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const first=await publishStatePeople({store,vault,state:"az",roster:{...roster,currentMembershipComplete:false},acquisitions,
    releaseId:"a".repeat(40),now:at,gaps:[{sourceUrl:url,detail:"SOURCE_PARTIAL: unfinished source parsing"}]});
  assert.ok(first.outcome.promoted);
  const partial={...first.outcome.candidate.candidate,id:"explicitly-incomplete-source",retrieval:{...first.outcome.candidate.candidate.retrieval,complete:false}};
  assert.ok((await processRegisteredRoutineCandidate(store,"openstates-people-az",partial,at,undefined,{confirmUnchanged:false})).promoted);
  const head=await store.readSourceHead("STATE_LEGISLATOR",scope);assert.equal(head?.acquisitionComplete,false);
  for(const method of["readCandidate","readCandidatePath","readPromotion","events"]as const)
    Object.assign(store,{[method]:async()=>{throw Error(`partial hash guard opened ${method}`);}});
  const confirmed=await confirmSourceHashUnchanged({store,sourceId:head!.sourceId,recordClass:head!.recordClass,scope,parserVersion:head!.parserVersion,
    rawHash:head!.rawHash!,complete:true,now:later,retrieval:{requestedUrl:url,finalUrl:url,httpStatus:200,rawHash:head!.rawHash!,retrievedAt:later}});
  assert.equal(confirmed,null,"completed source work must publish its completed payload and clear its old continuation");
});
