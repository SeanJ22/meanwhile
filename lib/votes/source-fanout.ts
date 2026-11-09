import { confirmSourceHashUnchanged,type SourceHashConfirmation } from "../civic-data/source-hash.ts";
import { processRegisteredManualCandidate,type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineCandidate } from "../civic-data/types.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";

/** Members settled at once: the database client is stateless HTTP, so no connection pool caps this; it matches the runner clock reads. */
export const FEDERAL_VOTE_MEMBER_CONCURRENCY=8;

/** A matching national hash cannot hide member pointers left behind by an interrupted fanout. */
export async function settleFederalVoteSources(input:{
  readonly store:RoutineDataStore;
  readonly members:Iterable<RoutineCandidate>;
  readonly source:Omit<Parameters<typeof confirmSourceHashUnchanged>[0],"store">;
  readonly publish?:(candidate:RoutineCandidate)=>Promise<PromotionOutcome>;
}):Promise<{readonly confirmed:SourceHashConfirmation|null;readonly refused:readonly string[]}>{
  const refused:string[]=[],members=input.members[Symbol.iterator](),workers:Promise<void>[]=[];
  let index=0,failure:{readonly error:unknown}|null=null;
  // Members have their own scopes and pointers, so they settle side by side; the iterator is drawn one at a time to keep candidates lazy.
  for(let w=0;w<FEDERAL_VOTE_MEMBER_CONCURRENCY;w++)workers.push((async()=>{
    for(let next=members.next();!next.done&&!failure;next=members.next()){
      const member=next.value,at=index++;
      try{
        const confirmed=member.retrieval.rawHash?await confirmSourceHashUnchanged({store:input.store,sourceId:member.sourceId,
          recordClass:member.recordClass,scope:member.scope,parserVersion:member.normalization.parserVersion,rawHash:member.retrieval.rawHash,
          now:input.source.now,complete:member.retrieval.complete!==false,
          retrieval:{requestedUrl:member.retrieval.requestedUrl,finalUrl:member.retrieval.finalUrl,httpStatus:member.retrieval.httpStatus,
            rawHash:member.retrieval.rawHash,retrievedAt:member.retrieval.retrievedAt,...(member.retrieval.sourceCheck?{sourceCheck:member.retrieval.sourceCheck}:{})}}):null;
        if(confirmed)continue;
        const result=await(input.publish?input.publish(member):processRegisteredManualCandidate(input.store,"congress-rollcalls",member,input.source.now));
        if(!result.promoted&&!result.confirmed)refused[at]=`${member.scope}:${result.candidate.failureCode??result.candidate.state}`;
      }catch(error){failure??={error};}
    }
  })());
  await Promise.all(workers);
  if(failure)throw(failure as {error:unknown}).error;
  return{refused:refused.filter(Boolean),confirmed:refused.length?null:await confirmSourceHashUnchanged({...input.source,store:input.store})};
}
