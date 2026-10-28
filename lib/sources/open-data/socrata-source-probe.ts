import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { confirmSourceHashUnchanged,type SourceHashConfirmation } from "../../civic-data/source-hash.ts";
import type { SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import { acquireKnownRelease } from "../known-release.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { OPEN_DATA_PARSER,openDataScope } from "./model.ts";
import { openDataFetch } from "./acquire.ts";
import { openDataProbeContentHash,openDataSourceContentHash,socrataDiscoveryRequest,SOCRATA_DISCOVERY_VERSION,
  type OpenDataSourceProbe,type SocrataDiscoveryRequest } from "./source-probe.ts";
import type { OpenDataCapture } from "./publication.ts";

interface ProbeProgress {context:string;basis:OpenDataCapture;records:readonly SocrataDiscoveryRequest[]}
const NAMESPACE="source-probe-progress:v1",KEY="socrata-discovery:national";
const key=(request:SocrataDiscoveryRequest)=>canonicalCivicDataJson([request.sourceId,request.releaseId,request.requestedUrl]);
/** Every native catalog page and every discovery root is checked; unchanged known links never replace new-link discovery. */
export async function confirmSocrataSource(input:{store:RoutineDataStore;plan:OpenDataSourceProbe|null;versionId:string|null;
  captures:readonly OpenDataCapture[];dependencies:SourceProbeDependencies;signal:AbortSignal;now:string;maxAgeMs:number;
  acquire?:typeof acquireKnownRelease;progress?:CivicReadCache}):Promise<SourceHashConfirmation|null> {
  const plan=input.plan;
  if(!plan||!plan.complete||plan.formatVersion!==1||plan.sourceId!=="socrata-discovery"||plan.parserVersion!==OPEN_DATA_PARSER||
    plan.discoveryVersion!==SOCRATA_DISCOVERY_VERSION||!plan.discoveryRequests?.length||
    canonicalCivicDataJson(plan.dependencies)!==canonicalCivicDataJson(input.dependencies)||
    openDataSourceContentHash(plan.requests)!==openDataSourceContentHash(input.captures))return null;
  const cache=input.progress??runtimeCivicReadCache().jobState();
  const context=createHash("sha256").update(canonicalCivicDataJson([input.versionId,plan])).digest("hex");
  const held=await cache.readCheckpoint<ProbeProgress>(NAMESPACE,KEY),minimum=Date.parse(input.now)-input.maxAgeMs;
  const fresh=(at:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)>minimum&&Date.parse(at)<=Date.parse(input.now);
  const saved=held?.context===context&&held.basis?.sourceCheck&&fresh(held.basis.sourceCheck.checkedAt)?held:null;
  const current=input.captures.filter(capture=>capture.sourceCheck).sort((a,b)=>a.sourceCheck!.checkedAt.localeCompare(b.sourceCheck!.checkedAt))[0];
  const basis=saved?.basis??current;
  if(!basis?.sourceCheck||!fresh(basis.sourceCheck.checkedAt))return null;
  const records=new Map<string,SocrataDiscoveryRequest>((saved?.records??[]).map(record=>[key(record),record]));
  const save=()=>cache.checkpoint(NAMESPACE,KEY,{context,basis,records:[...records.values()]});
  for(let offset=0;offset<plan.discoveryRequests.length;offset+=16) {
    input.signal.throwIfAborted();
    const batch=plan.discoveryRequests.slice(offset,offset+16);
    const results=await runBoundedWorkPool(batch,16,async request=>{
      const prior=records.get(key(request));
      if(prior&&prior.rawHash===request.rawHash&&fresh(prior.checkedAt)&&Date.parse(prior.checkedAt)>=Date.parse(basis.sourceCheck!.checkedAt))return prior;
      if(!["socrata-state-links","socrata-government-links"].includes(request.sourceId))throw Error("Socrata source plan has an unsupported request.");
      const url=new URL(request.requestedUrl);
      if([...url.searchParams.keys()].some(field=>/^(?:api[_-]?key|key|token|access[_-]?token|authorization|secret|password)$/i.test(field)))
        throw Error("Socrata source credentials must be supplied by the runtime provider.");
      const release=await (input.acquire??acquireKnownRelease)({sourceId:request.sourceId,releaseId:request.releaseId,url:request.requestedUrl,
        parserVersion:OPEN_DATA_PARSER,maxBytes:4*1024*1024,checkAfterMs:0,refresh:true,signal:input.signal,
        fetchImpl:(resource,init)=>openDataFetch(resource,init),headers:{accept:"text/html"}});
      const observed=socrataDiscoveryRequest(release);
      if(!observed)throw Error("Socrata discovery source has no successful current check.");
      return observed;
    });
    for(const result of results)if(result.ok)records.set(key(result.value),result.value);
    await save();input.signal.throwIfAborted();
    if(results.some((result,index)=>!result.ok||result.value.rawHash!==batch[index].rawHash||result.value.finalUrl!==batch[index].finalUrl))return null;
  }
  const observed:OpenDataSourceProbe={...plan,requests:input.captures.map(({url,rawHash,archive})=>({url,rawHash,...(archive?{archive}:{})})),
    discoveryRequests:plan.discoveryRequests.map(request=>records.get(key(request))!)};
  const rawHash=openDataProbeContentHash(observed);
  const confirmed=await confirmSourceHashUnchanged({store:input.store,sourceId:"socrata-discovery",recordClass:"CURATED_READER_RECORD",
    scope:openDataScope("socrata-discovery","national"),parserVersion:OPEN_DATA_PARSER,rawHash,now:input.now,complete:true,
    retrieval:{requestedUrl:basis.url,finalUrl:basis.sourceCheck.finalUrl,httpStatus:200,rawHash,retrievedAt:basis.retrievedAt,sourceCheck:basis.sourceCheck}});
  if(confirmed)await cache.checkpoint(NAMESPACE,KEY,null);
  return confirmed;
}
