import { canonicalCivicDataHash } from "../civic-data/changes.ts";
import { sourceContentHash } from "../civic-data/source-hash.ts";
import type { RoutineDataStore, SourceHead } from "../civic-data/store.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";

/** A source-authenticated roster exposes exact native IDs without contact or person payloads. */
export async function readOfficialRosterIds(store:Pick<RoutineDataStore,"readCandidatePath">,head:SourceHead|null):Promise<readonly string[]>{
  if(!head||head.candidateState!=="PROMOTED"||!head.acquisitionSucceeded||head.imported||head.versionId!==head.lastKnownGoodVersionId)return[];
  const identities=await store.readCandidatePath<readonly {subjectId:string}[]>(head.versionId,["identities"]);
  return identities?.map(identity=>identity.subjectId)??[];
}

/** Observation timestamps and wrapper versions never make unchanged official source bytes move. */
export function officialVoteSourceHash(pages:Parameters<typeof sourceContentHash>[0],roster:SourceHead|null):string{
  return sourceContentHash(pages,{roster:roster?[roster.sourceId,roster.scope,roster.rawHash,roster.parserVersion]:null});
}

export function withOfficialVoteSourceHash(candidate:RoutineCandidate,rawHash:string):RoutineCandidate{
  const normalizedPayload={...candidate.normalizedPayload as Record<string,unknown>,sourceInputHash:rawHash};
  return{...candidate,id:`cv-${canonicalCivicDataHash([candidate.sourceId,candidate.recordClass,candidate.scope,rawHash,
    candidate.normalization.parserVersion,candidate.retrieval.retrievedAt]).slice(0,32)}`,
    retrieval:{...candidate.retrieval,rawHash,rawHashBasis:"SOURCE_CONTENT_V1",complete:true},
    normalization:{...candidate.normalization,normalizedPayloadHash:canonicalCivicDataHash(normalizedPayload)},normalizedPayload};
}
