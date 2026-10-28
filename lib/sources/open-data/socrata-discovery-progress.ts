import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import { acquireKnownRelease,type KnownRelease,type KnownReleaseOptions } from "../known-release.ts";
import type { OpenDataCapture } from "./publication.ts";
import type { PortalBinding } from "./normalize.ts";
import { socrataDiscoveryRequest } from "./source-probe.ts";

type Observation=Omit<KnownRelease,"bytes">;
interface StateWork {state:string;bindings:readonly PortalBinding[];observations:readonly Observation[];complete:boolean}
interface DiscoveryWork {context:string;basis:OpenDataCapture;states:readonly StateWork[]}
const NAMESPACE="source-probe-progress:v1",KEY="socrata-normal-discovery:national";
/** The standing source job's own discovery position; its current source/input hash decides every reuse. */
export async function socrataDiscoveryProgress(input:{context:string;captures:readonly OpenDataCapture[];now:string;maxAgeMs:number;progress?:CivicReadCache;
  acquire?:typeof acquireKnownRelease}) {
  const cache=input.progress??runtimeCivicReadCache().jobState(),held=await cache.readCheckpoint<DiscoveryWork>(NAMESPACE,KEY);
  const minimum=Date.parse(input.now)-input.maxAgeMs;
  const fresh=(at:string)=>Date.parse(at)>minimum&&Date.parse(at)<=Date.parse(input.now);
  const saved=held?.context===input.context&&held.basis?.sourceCheck&&fresh(held.basis.sourceCheck.checkedAt)?held:null;
  const basis=saved?.basis??input.captures.filter(row=>row.sourceCheck).sort((a,b)=>a.sourceCheck!.checkedAt.localeCompare(b.sourceCheck!.checkedAt))[0];
  const states=new Map<string,StateWork>((saved?.states??[]).map(row=>[row.state,row]));
  const save=()=>cache.checkpoint(NAMESPACE,KEY,{context:input.context,basis,states:[...states.values()]});
  await save();
  return {
    basis,
    completed(state:string){const row=states.get(state);return row?.complete&&row.observations.length&&
      row.observations.every(observation=>!observation.outage&&fresh(observation.checkedAt))?row:null;},
    async saveState(state:StateWork){
      const observations=state.observations.filter(row=>socrataDiscoveryRequest(row)!==null).map(row=>{
        const {sourceId,releaseId,sha256,requestedUrl,finalUrl,httpStatus,retrievedAt,sourceObservedAt,checkedAt,lastCheckStatus,
          etag,lastModified,contentType,reused,vaultKey,outage}=row;
        return {sourceId,releaseId,sha256,requestedUrl,finalUrl,httpStatus,retrievedAt,sourceObservedAt,checkedAt,lastCheckStatus,
          etag,lastModified,contentType,reused,...(vaultKey?{vaultKey}:{}),...(outage?{outage}:{})};
      });
      states.set(state.state,{...state,observations,complete:state.complete&&observations.length===state.observations.length});await save();
    },
    acquire:(options:KnownReleaseOptions)=>(input.acquire??acquireKnownRelease)({...options,
      // A cutoff reuses the exact already-checked pages from this work slice, with their original dates.
      ...(basis?.sourceCheck?{checkedAfter:basis.sourceCheck.checkedAt,checkAfterMs:input.maxAgeMs}:{}),refresh:false}),
    async clear(){await cache.checkpoint(NAMESPACE,KEY,null);},
  };
}
