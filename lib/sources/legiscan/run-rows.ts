import { candidateProofView,type RoutineDataStore } from "../../civic-data/store.ts";
import { projectionKey } from "../../civic-data/projection-key.ts";
import type { CandidateVersionRecord,PromotedProjection,RoutineCandidate,RoutineRecordClass } from "../../civic-data/types.ts";

/** Rebuilt candidates kept at once; a part is rebuilt from bytes the publisher already holds. */
const RECENT_ROWS=4;
export type RunRowStore<S extends RoutineDataStore=RoutineDataStore>=S & {
  /** Serve this exact immutable candidate from memory; `build` must reproduce it byte for byte. */
  readonly hold:(row:Pick<RoutineCandidate,"id"|"recordClass"|"scope">,build:()=>RoutineCandidate)=>void;
};

/**
 * One LegiScan session publish: rows it writes (or proves equal to a saved row) are never read back whole.
 * A candidate body is immutable once written, so a held body is used only after the database's own small
 * metadata row confirms its id, scope, raw hash and both normalized hashes; its state, receipt and pointer
 * are always read fresh. Anything not held, or any mismatch, reads the row exactly as before.
 */
export function runRowStore<S extends RoutineDataStore>(store:S):RunRowStore<S> {
  const builds=new Map<string,()=>RoutineCandidate>(),pointed=new Map<string,string>(),recent=new Map<string,RoutineCandidate>();
  const body=(id:string)=>{
    const value=recent.get(id)??builds.get(id)!();
    recent.delete(id);recent.set(id,value);
    for(const key of recent.keys()){if(recent.size<=RECENT_ROWS)break;recent.delete(key);}
    return value;
  };
  /** `undefined` means "not held here": the caller reads the row. */
  const record=async(id:string):Promise<CandidateVersionRecord|null|undefined>=>{
    if(!builds.has(id))return undefined;
    const meta=await store.readPublishedCandidateMetadata(id);
    if(!meta)return null;
    const held=body(id),saved=meta.candidate;
    if(held.id!==saved.id||held.scope!==saved.scope||held.sourceId!==saved.sourceId||held.recordClass!==saved.recordClass||
      held.retrieval.rawHash!==saved.retrieval.rawHash||held.retrieval.retrievedAt!==saved.retrieval.retrievedAt||
      held.normalization.normalizedHash!==saved.normalization.normalizedHash||held.normalization.normalizedPayloadHash!==saved.normalization.normalizedPayloadHash)return undefined;
    return {...meta,candidate:held};
  };
  const hold:RunRowStore["hold"]=(row,build)=>{builds.set(row.id,build);pointed.set(projectionKey(row.recordClass,row.scope),row.id);};
  const readCandidate=async(id:string)=>{const held=await record(id);return held===undefined?store.readCandidate(id):held;};
  const readCandidateProof=async(id:string)=>{
    const held=await record(id);
    if(held!==undefined)return held&&{...held,candidate:candidateProofView(held.candidate)};
    return store.readCandidateProof?store.readCandidateProof(id):store.readCandidate(id);
  };
  const readPromotion=async<T,>(recordClass:RoutineRecordClass,scope:string):Promise<PromotedProjection<T>|null>=>{
    const id=pointed.get(projectionKey(recordClass,scope));
    if(id===undefined)return store.readPromotion<T>(recordClass,scope);
    const identity=await store.readPromotionIdentity(recordClass,scope);
    if(identity?.versionId!==id)return identity===null?null:store.readPromotion<T>(recordClass,scope);
    const held=await record(id);
    if(!held?.receipt)return store.readPromotion<T>(recordClass,scope);
    return {...identity,payload:held.candidate.readModel as T,receipt:held.receipt};
  };
  // The store's promote checks a held candidate's envelope and hashes against its row before using it.
  const promote:RoutineDataStore["promote"]=(id,receipt,at,options)=>store.promote(id,receipt,at,options??(builds.has(id)?{candidate:body(id)}:undefined));
  const own:Record<PropertyKey,unknown>={hold,readCandidate,readCandidateProof,readPromotion,promote};
  // A proxy keeps the store's class, so production contract doors still recognize it.
  return new Proxy(store,{get(target,key){
    if(Object.hasOwn(own,key))return own[key];
    const value=Reflect.get(target,key,target);
    return typeof value==="function"?value.bind(target):value;
  }}) as RunRowStore<S>;
}
