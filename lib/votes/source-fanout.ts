import { confirmSourceHashUnchanged,type SourceHashConfirmation } from "../civic-data/source-hash.ts";
import { processRegisteredManualCandidate,type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";

/** A matching national hash cannot hide member pointers left behind by an interrupted fanout. */
export async function settleFederalVoteSources(input:{
  readonly store:RoutineDataStore;
  readonly members:Iterable<RoutineCandidate>;
  readonly source:Omit<Parameters<typeof confirmSourceHashUnchanged>[0],"store">;
  readonly publish?:(candidate:RoutineCandidate)=>Promise<PromotionOutcome>;
}):Promise<{readonly confirmed:SourceHashConfirmation|null;readonly refused:readonly string[]}>{
  const refused:string[]=[];
  for(const member of input.members){
    const confirmed=member.retrieval.rawHash?await confirmSourceHashUnchanged({store:input.store,sourceId:member.sourceId,
      recordClass:member.recordClass,scope:member.scope,parserVersion:member.normalization.parserVersion,rawHash:member.retrieval.rawHash,
      now:input.source.now,complete:member.retrieval.complete!==false,
      retrieval:{requestedUrl:member.retrieval.requestedUrl,finalUrl:member.retrieval.finalUrl,httpStatus:member.retrieval.httpStatus,
        rawHash:member.retrieval.rawHash,retrievedAt:member.retrieval.retrievedAt,...(member.retrieval.sourceCheck?{sourceCheck:member.retrieval.sourceCheck}:{})}}):null;
    if(confirmed)continue;
    const result=await(input.publish?input.publish(member):processRegisteredManualCandidate(input.store,"congress-rollcalls",member,input.source.now));
    if(!result.promoted&&!result.confirmed)refused.push(`${member.scope}:${result.candidate.failureCode??result.candidate.state}`);
  }
  return{refused,confirmed:refused.length?null:await confirmSourceHashUnchanged({...input.source,store:input.store})};
}
