import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { requiredManualProductionContract,type ManualProductionContractId } from "./manual-contracts.ts";
import { sourceAuthority } from "./source-authority.ts";
import type { RoutineDataStore,SourceHead } from "./store.ts";
import type { RoutineCandidate } from "./types.ts";
import { manualPriorAuthorityOf } from "./manual-prior-authority.ts";

/** The reviewed package is parser input. Its exact dates and scope matter, but replaying it is no new HTTP check. */
export function manualPackageInputDigest(contractId:ManualProductionContractId,input:unknown):string {
  const contract=requiredManualProductionContract(contractId);
  return canonicalCivicDataHash({input,contract,authority:sourceAuthority(contract.sourceId)});
}
export function withManualPackageInput<T extends RoutineCandidate>(candidate:T,inputDigest:string,sourceRawHash:string|null=candidate.retrieval.rawHash):T {
  const incomplete=!!manualPriorAuthorityOf(candidate)?.retainedMembers.length||candidate.normalization.droppedRecords>0||
    !candidate.horizon.paginationComplete||candidate.excludedFacts?.some(fact=>/HELD|RETAINED/.test(fact.code))||
    candidate.retrieval.manualSourceReceipt?.sources.some(source=>source.reviewOutcome==="BLOCKED");
  return {...candidate,id:`cv-${canonicalCivicDataHash([candidate.id,inputDigest]).slice(0,32)}`,
    retrieval:{...candidate.retrieval,rawHash:sourceRawHash,rawHashBasis:"SOURCE_CONTENT_V1",complete:candidate.retrieval.complete!==false&&!incomplete},
    normalization:{...candidate.normalization,sourceInputDigest:inputDigest}};
}
/** Select only the current scalar source/proof and exact applied package digest. No event or freshness change is made. */
export async function readManualPackageReplay(store:RoutineDataStore,candidate:Pick<RoutineCandidate,"sourceId"|"recordClass"|"scope"|"retrieval"|"normalization">,
  inputDigest:string):Promise<SourceHead|null> {
  const head=await store.readSourceHead(candidate.recordClass,candidate.scope);
  if(!head||!head.proofCoupled||head.imported||head.sourceId!==candidate.sourceId||head.recordClass!==candidate.recordClass||head.scope!==candidate.scope||
    head.candidateState!=="PROMOTED"||!head.acquisitionSucceeded||head.versionId!==head.lastKnownGoodVersionId||head.rawHashBasis!=="SOURCE_CONTENT_V1"||
    !head.normalizedHash||head.rawHash!==candidate.retrieval.rawHash||head.parserVersion!==candidate.normalization.parserVersion||
    await store.readCandidatePath(head.versionId,["normalization","sourceInputDigest"])!==inputDigest)return null;
  const current=await store.readSourceHead(candidate.recordClass,candidate.scope);
  return current?.versionId===head.versionId&&current.proofCoupled?current:null;
}
