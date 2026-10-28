import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import type { CountyCivicCoverage } from "./coverage.ts";
import { civicInputHash } from "./source-hash.ts";
import { GOOGLE_CIVIC_API } from "./targets.ts";
import type { SourceCheckEvidence } from "../../civic-data/types.ts";

export interface CountyCivicSample {
  readonly addressHash:string;
  readonly responseHash:string|null;
  readonly status:number;
  readonly checkedAt:string;
  readonly coverage:CountyCivicCoverage;
}
interface CountyProgress {context:string;basis:SourceCheckEvidence;records:readonly CountyCivicSample[]}
export interface CivicStateWork {state:string;inputHash:string;hash:string;versionId:string;complete:boolean;basis:SourceCheckEvidence}
/** Completed states are part of this same interrupted national pass; their actual source check is never advanced by reuse. */
export async function nationalCivicProgress(input:{context:string;checkedAt:string;maxAgeMs:number;progress?:CivicReadCache}) {
  const cache=input.progress??runtimeCivicReadCache().jobState(),namespace="source-probe-progress:v1",key="google-civic:national";
  const held=await cache.readCheckpoint<{context:string;states:readonly CivicStateWork[]}>(namespace,key),minimum=Date.parse(input.checkedAt)-input.maxAgeMs;
  const states=new Map((held?.context===input.context?held.states:[]).filter(row=>Date.parse(row.basis.checkedAt)>minimum&&
    Date.parse(row.basis.checkedAt)<=Date.parse(input.checkedAt)).map(row=>[row.state,row]));
  return {get:(state:string)=>states.get(state),
    async put(row:CivicStateWork){states.set(row.state,row);await cache.checkpoint(namespace,key,{context:input.context,states:[...states.values()]});},
    clear:()=>cache.checkpoint(namespace,key,null)};
}
/** Successful availability/count samples are already standing work. No address, credential or voterinfo body is saved. */
export async function countyCivicProgress(input:{state:string;context:string;catalogHash:string;checkedAt:string;maxAgeMs:number;progress?:CivicReadCache}) {
  const cache=input.progress??runtimeCivicReadCache().jobState(),namespace="source-probe-progress:v1",key=`google-civic:${input.state}`;
  const held=await cache.readCheckpoint<CountyProgress>(namespace,key),minimum=Date.parse(input.checkedAt)-input.maxAgeMs;
  const fresh=(at:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)>minimum&&Date.parse(at)<=Date.parse(input.checkedAt);
  const saved=held?.context===input.context&&held.basis?.rawHash===input.catalogHash&&fresh(held.basis.checkedAt)?held:null;
  const basis=saved?.basis??{requestedUrl:`${GOOGLE_CIVIC_API}elections`,finalUrl:`${GOOGLE_CIVIC_API}elections`,httpStatus:200 as const,
    rawHash:input.catalogHash,checkedAt:input.checkedAt};
  const recordKey=(countyFips:string,addressHash:string)=>civicInputHash([countyFips,addressHash]);
  const records=new Map((saved?.records??[]).filter(record=>fresh(record.checkedAt)).map(record=>[recordKey(record.coverage.countyFips,record.addressHash),record]));
  return {basis,records,
    get:(countyFips:string,addressHash:string)=>records.get(recordKey(countyFips,addressHash)),
    put:(record:CountyCivicSample)=>records.set(recordKey(record.coverage.countyFips,record.addressHash),record),
    save:()=>cache.checkpoint(namespace,key,{context:input.context,basis,records:[...records.values()]}),
    clear:()=>cache.checkpoint(namespace,key,null),
  };
}
