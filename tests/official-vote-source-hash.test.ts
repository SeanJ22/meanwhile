import assert from "node:assert/strict";
import test from "node:test";
import { officialStateLegislatorVotesCandidate } from "../lib/civic-data/candidate-builders.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/changes.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";
import { officialVoteSourceHash, readOfficialRosterIds, withOfficialVoteSourceHash } from "../lib/state-rollcalls/source-hash.ts";

const roster:SourceHead={sourceId:"nh-general-court",recordClass:"STATE_LEGISLATOR",scope:"US-NH",versionId:"roster-v1",lastKnownGoodVersionId:"roster-v1",
  rawHash:"a".repeat(64),normalizedHash:"b".repeat(64),parserVersion:"nh-general-court/3",promotedAt:"2026-10-25T12:00:00.000Z",
  candidateState:"PROMOTED",acquisitionSucceeded:true,imported:false,rawHashBasis:"SOURCE_CONTENT_V1"};
const document={requestedUrl:"https://gc.nh.gov/rollcalls",finalUrl:"https://gc.nh.gov/rollcalls",body:"official source bytes"};

test("official vote source movement follows bytes and the roster source, not its observation or wrapper version",()=>{
  const hash=officialVoteSourceHash([document],roster);
  assert.equal(hash,officialVoteSourceHash([document],{...roster,versionId:"roster-v2",promotedAt:"2026-10-26T12:00:00.000Z"}));
  assert.notEqual(hash,officialVoteSourceHash([{...document,body:"changed official bytes"}],roster));
  assert.notEqual(hash,officialVoteSourceHash([document],{...roster,rawHash:"c".repeat(64)}));
});

test("native roster IDs use only the pointed identity evidence and reject an imported or divergent pointer",async()=>{
  const paths:readonly string[][]=[];
  const store={readCandidatePath:async<T>(versionId:string,path:readonly string[]):Promise<T|null>=>{
    assert.equal(versionId,roster.versionId);(paths as string[][]).push([...path]);return[{subjectId:"nh-general-court:1"}] as T;
  }};
  assert.deepEqual(await readOfficialRosterIds(store,roster),["nh-general-court:1"]);
  assert.deepEqual(paths,[["identities"]]);
  assert.deepEqual(await readOfficialRosterIds(store,{...roster,imported:true}),[]);
  assert.deepEqual(await readOfficialRosterIds(store,{...roster,lastKnownGoodVersionId:"other"}),[]);
  assert.equal(paths.length,1);
});

test("stable source hashes retain existing candidate fields and exact normalization hashes",()=>{
  const candidate=officialStateLegislatorVotesCandidate({sourceId:"nh-general-court",jurisdiction:"US-NH",officeholderId:"nh-general-court:1",chamber:"House",
    term:"2026",session:"regular",positions:[{rollCallId:"nh-general-court:roll-1",position:"YES",date:"2026-10-25"}],
    requestedUrl:document.requestedUrl,finalUrl:document.finalUrl,httpStatus:200,retrievedAt:"2026-10-26T12:00:00.000Z",
    identityAuthority:{sourceId:"nh-general-court",scope:"US-NH",contractId:"nh-members",versionId:roster.versionId,currentOfficeholderIdsSha256:"d".repeat(64),
      sessionParticipantSet:{term:"2026",session:"regular",sourceVersion:"source",count:1,officeholderIdsSha256:"e".repeat(64)}}});
  const rawHash=officialVoteSourceHash([document],roster),stable=withOfficialVoteSourceHash(candidate,rawHash);
  assert.equal(stable.retrieval.rawHash,rawHash);assert.equal(stable.retrieval.rawHashBasis,"SOURCE_CONTENT_V1");
  assert.equal(stable.normalization.normalizedPayloadHash,canonicalCivicDataHash(stable.normalizedPayload));
  assert.deepEqual(stable.readModel,candidate.readModel);
  assert.equal((stable.normalizedPayload as {officeholderId:string}).officeholderId,"nh-general-court:1");
});
