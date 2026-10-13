import { createHash } from "node:crypto";
import type { OfficeholderSet } from "../../officials/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import { RepositoryLockHeld } from "../../control-plane/repository/types.ts";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions } from "../known-release.ts";
import { sourceAcquisitionFailure, requestPublisher, readPublisherBody } from "../../civic-data/source-acquisition-error.ts";
import { readCompleteResponse } from "../source-bytes.ts";
import { georgiaPublicTokenRequest, georgiaPublicApiRequest, georgiaCurrentSession,
  GEORGIA_SESSIONS_URL, GEORGIA_MEMBER_URL_PREFIX } from "./request.ts";
import { ALASKA_DIRECTORY_URL, alaskaCurrentProfileRoutes, alaskaProfileIssue } from "./alaska.ts";
import { parseSenateServiceTable } from "./senate-vacancies.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { resolveOfficialRosterMarker, wyomingCurrentModuleRoutes, resolveWyomingCurrentModules } from "./current-markers.ts";
import { parseHouseRoster, parseSenateRoster, parseSenateAppointments, type OfficialRosterDocument } from "./federal.ts";
import { OFFICIAL_ROSTER_TARGETS, OFFICIAL_FEDERAL_TARGETS, HOUSE_ROSTER_URL, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL,
  OFFICIAL_LEGISLATURE_TARGETS, type OfficialRosterTarget } from "./targets.ts";
import { parseLegislatureRoster } from "./legislature.ts";

export { OFFICIAL_ROSTER_TARGETS, OFFICIAL_FEDERAL_TARGETS, HOUSE_ROSTER_URL, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL };
export { OFFICIAL_LEGISLATURE_TARGETS, type OfficialRosterTarget, type OfficialRosterDocument };
const DAY = 86_400_000;
export interface OfficialRosterRelease {
  readonly target: OfficialRosterTarget;
  readonly releaseId: string;
  readonly roster: OfficeholderSet;
  readonly acquisitions: readonly StatePeopleAcquisition[];
  readonly gaps: readonly { sourceUrl: string; detail: string }[];
  readonly complete: boolean;
}
export function officialRosterTarget(id: string): OfficialRosterTarget | undefined {
  return OFFICIAL_ROSTER_TARGETS.find(target=>target.id===id);
}
/** Pure parser: every identity and seat must be supplied by this publisher. */
export function parseOfficialRoster(targetOrId: OfficialRosterTarget | string, documents: readonly OfficialRosterDocument[], retrievedAt: string): OfficeholderSet {
  const target = typeof targetOrId === "string" ? officialRosterTarget(targetOrId) : targetOrId;
  if (!target) throw new Error("OFFICIAL_ROSTER_TARGET_UNKNOWN");
  if (!documents.length || documents.some(document=>!target.routes.includes(document.url))) throw new Error("OFFICIAL_ROSTER_DOCUMENT_ROUTE_INVALID");
  return target.kind === "senate" ? parseSenateRoster(documents,retrievedAt) : target.kind === "house" ? parseHouseRoster(documents,retrievedAt)
    : parseLegislatureRoster(target,documents,retrievedAt);
}
/** All routine and Admin checks share immutable evidence and its conditional
 * source index. A 304 confirms held bytes without changing their source date. */
export async function acquireOfficialRoster(input: Pick<KnownReleaseOptions,"store"|"locks"|"fetchImpl"|"now"> & {
  readonly targetId: string;
  readonly signal: AbortSignal;
  readonly refresh?: boolean;
}): Promise<OfficialRosterRelease> {
  let target = officialRosterTarget(input.targetId);
  if (!target) throw new Error("OFFICIAL_ROSTER_TARGET_UNKNOWN");
  const now = input.now?.() ?? new Date().toISOString();
  const gaps: {sourceUrl:string;detail:string}[] = [];
  const documents: OfficialRosterDocument[] = [], acquisitions: StatePeopleAcquisition[] = [];
  let fetchImpl = input.fetchImpl ?? fetch;
  if (target.state === "GA") {
    const baseFetch = fetchImpl;
    let tokenPromise: Promise<string> | undefined;
    fetchImpl = (async (requested,init)=>{
      const token = await (tokenPromise ??= (async ()=>{
        const request = georgiaPublicTokenRequest(now);
        const tokenHeaders = new Headers(request.init.headers);
        const projectAgent = new Headers(init?.headers).get("user-agent");
        if(projectAgent)tokenHeaders.set("user-agent",projectAgent);
        tokenHeaders.set("accept","application/json");
        const response = await requestPublisher("Georgia public legislature website",()=>baseFetch(request.url,{...request.init,headers:tokenHeaders,signal:input.signal,redirect:"follow"}));
        if (!response.ok) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED",`Georgia public website access answered HTTP ${response.status}.`);
        if (response.url && new URL(response.url).hostname!=="www.legis.ga.gov") throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED","Georgia public website access redirected outside its publisher.");
        const bytes = await readPublisherBody("Georgia public legislature website",()=>readCompleteResponse(response,64*1024));
        let value: unknown;
        try { value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)); }
        catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","Georgia public website access returned an unreadable response."); }
        if (typeof value!=="string" || !value || /[\r\n]/.test(value)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID","Georgia public website access returned no usable public token.");
        return value;
      })());
      const headers = new Headers(init?.headers);
      new Headers(georgiaPublicApiRequest(token,String(requested)).headers).forEach((value,key)=>headers.set(key,value));
      return baseFetch(requested,{...init,headers});
    }) as typeof fetch;
    try {
      const sessions = await acquireKnownRelease({sourceId:target.sourceId,releaseId:"official-legislature-ga:current-session",url:GEORGIA_SESSIONS_URL,
        parserVersion:"georgia-official-session/1",signal:input.signal,maxBytes:1024*1024,checkAfterMs:DAY,refresh:input.refresh,
        store:input.store,locks:input.locks,fetchImpl,now:input.now,headers:{accept:"application/json"},
        validate:bytes=>{georgiaCurrentSession(bytes);}});
      const session=georgiaCurrentSession(sessions.bytes),url=`${GEORGIA_MEMBER_URL_PREFIX}${session}`;
      acquisitions.push({requestedUrl:sessions.requestedUrl,finalUrl:sessions.finalUrl,httpStatus:sessions.httpStatus,retrievedAt:sessions.retrievedAt,
        rawHash:sessions.sha256,body:new TextDecoder("utf-8",{fatal:true}).decode(sessions.bytes),sourceCheck:knownReleaseSourceCheck(sessions),
        ...(sessions.vaultKey?{vaultKey:sessions.vaultKey}:{})});
      target={...target,routes:[url],legislatureRoutes:[{url,chamber:"both"}]};
    } catch(error) {
      input.signal.throwIfAborted();
      if(error instanceof RepositoryLockHeld)throw error;
      return {target,releaseId:createHash("sha256").update("unread-current-session").digest("hex"),acquisitions,gaps:[{sourceUrl:GEORGIA_SESSIONS_URL,
        detail:error instanceof Error?error.message:String(error)}],complete:false,
        roster:{scope:target.jurisdiction,generatedAt:now,officeholders:[],divisions:[],unmatched:[],currentMembershipComplete:false,coveredChambers:[]}};
    }
  }
  if (target.state === "AK") {
    try {
      const directory=await acquireKnownRelease({sourceId:target.sourceId,releaseId:`${target.id}:get:${ALASKA_DIRECTORY_URL}`,url:ALASKA_DIRECTORY_URL,
        parserVersion:target.parserVersion,signal:input.signal,maxBytes:16*1024*1024,checkAfterMs:DAY,refresh:input.refresh,
        store:input.store,locks:input.locks,fetchImpl,now:input.now,validate:bytes=>{alaskaCurrentProfileRoutes(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}});
      const body=new TextDecoder("utf-8",{fatal:true}).decode(directory.bytes),profiles=alaskaCurrentProfileRoutes(body);
      documents.push({url:ALASKA_DIRECTORY_URL,body,retrievedAt:directory.retrievedAt});
      acquisitions.push({requestedUrl:directory.requestedUrl,finalUrl:directory.finalUrl,httpStatus:directory.httpStatus,retrievedAt:directory.retrievedAt,
        rawHash:directory.sha256,body,sourceCheck:knownReleaseSourceCheck(directory),...(directory.vaultKey?{vaultKey:directory.vaultKey}:{})});
      target={...target,routes:[ALASKA_DIRECTORY_URL,...profiles],legislatureRoutes:[ALASKA_DIRECTORY_URL,...profiles].map(url=>({url,chamber:"both" as const}))};
    } catch(error) {
      input.signal.throwIfAborted();
      if(error instanceof RepositoryLockHeld)throw error;
      return {target,releaseId:createHash("sha256").update("unread-alaska-directory").digest("hex"),acquisitions,
        gaps:[{sourceUrl:ALASKA_DIRECTORY_URL,detail:error instanceof Error?error.message:String(error)}],complete:false,
        roster:{scope:target.jurisdiction,generatedAt:now,officeholders:[],divisions:[],unmatched:[],currentMembershipComplete:false,coveredChambers:[]}};
    }
  }
  if(target.currentMarker){
    const markerTarget=target,markerRoute=target.currentMarker;
    try{
      const marker=await acquireKnownRelease({sourceId:target.sourceId,releaseId:`${target.id}:current-marker:${markerRoute.url}`,url:markerRoute.url,
        parserVersion:markerRoute.parserVersion,signal:input.signal,maxBytes:8*1024*1024,checkAfterMs:DAY,refresh:input.refresh,
        store:input.store,locks:input.locks,fetchImpl,now:input.now,validate:bytes=>{
          if(markerTarget.state==="WY")wyomingCurrentModuleRoutes(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
          else resolveOfficialRosterMarker(markerTarget,bytes,now);
        }});
      const body=new TextDecoder("utf-8",{fatal:true}).decode(marker.bytes);
      acquisitions.push({requestedUrl:marker.requestedUrl,finalUrl:marker.finalUrl,httpStatus:marker.httpStatus,retrievedAt:marker.retrievedAt,
        rawHash:marker.sha256,body,sourceCheck:knownReleaseSourceCheck(marker),...(marker.vaultKey?{vaultKey:marker.vaultKey}:{})});
      if(markerTarget.state==="WY"){
        const modules=await runBoundedWorkPool(wyomingCurrentModuleRoutes(body),8,async url=>{
          const release=await acquireKnownRelease({sourceId:markerTarget.sourceId,releaseId:`${markerTarget.id}:application-module:${url}`,url,
            parserVersion:"wyoming-official-settings-module/1",signal:input.signal,maxBytes:8*1024*1024,checkAfterMs:DAY,refresh:input.refresh,
            store:input.store,locks:input.locks,fetchImpl,now:input.now,validate:bytes=>{if(!bytes.byteLength)throw new Error("Wyoming publisher application module is empty.");}});
          const moduleBody=new TextDecoder("utf-8",{fatal:true}).decode(release.bytes);
          return {document:{url,body:moduleBody},acquisition:{requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,httpStatus:release.httpStatus,
            retrievedAt:release.retrievedAt,body:moduleBody,rawHash:release.sha256,sourceCheck:knownReleaseSourceCheck(release),
            ...(release.vaultKey?{vaultKey:release.vaultKey}:{})} satisfies StatePeopleAcquisition};
        });
        const failed=modules.find(result=>!result.ok);
        if(failed && !failed.ok)throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE",failed.error);
        const successful=modules.flatMap(result=>result.ok?[result.value]:[]);
        acquisitions.push(...successful.map(value=>value.acquisition));
        target=resolveWyomingCurrentModules(markerTarget,successful.map(value=>value.document),now);
      }else target=resolveOfficialRosterMarker(markerTarget,marker.bytes,now);
      if(target.routes.includes(marker.requestedUrl))documents.push({url:marker.requestedUrl,body,retrievedAt:marker.retrievedAt,checkedAt:marker.checkedAt});
    }catch(error){
      input.signal.throwIfAborted();
      if(error instanceof RepositoryLockHeld)throw error;
      return {target,releaseId:createHash("sha256").update("unread-current-roster-marker").digest("hex"),acquisitions,
        gaps:[{sourceUrl:markerRoute.url,detail:error instanceof Error?error.message:String(error)}],complete:false,
        roster:{scope:target.jurisdiction,generatedAt:now,officeholders:[],divisions:[],unmatched:[],currentMembershipComplete:false,coveredChambers:[]}};
    }
  }
  const routes=target.routes.filter(url=>!documents.some(document=>document.url===url));
  const work=async (url:string)=>{
    const request = target.requests?.[url];
    const requestIdentity = request ? createHash("sha256").update(JSON.stringify([request.method,request.body ?? ""])).digest("hex") : "get";
    const transport: typeof fetch = request ? (async (requested,init)=>{
      const headers = new Headers(init?.headers);
      for (const [key,value] of Object.entries(request.headers ?? {})) headers.set(key,value);
      return fetchImpl(requested,{...init,headers,method:request.method,...(request.body===undefined?{}:{body:request.body})});
    }) : fetchImpl;
    const release = await acquireKnownRelease({ sourceId:target.sourceId,releaseId:`${target.id}:${requestIdentity}:${url}`,url,
      parserVersion:target.parserVersion,signal:input.signal,maxBytes:16*1024*1024,checkAfterMs:DAY,
      refresh:input.refresh,store:input.store,locks:input.locks,fetchImpl:transport,now:input.now,
      allowedHosts:[...new Set(target.routes.map(route=>new URL(route).hostname))],
      headers:{accept:target.kind==="legislature"?"text/html,application/json;q=0.9,*/*;q=0.5":"application/xml,text/html;q=0.9,*/*;q=0.5"},
      validate:(bytes,metadata)=>{
        const body = new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        try {
          if (url===SENATE_APPOINTMENTS_URL) parseSenateAppointments(body);
          else if (/^https:\/\/www\.senate\.gov\/states\/[A-Z]{2}\/senators\.htm$/.test(url)) parseSenateServiceTable({url,body,retrievedAt:metadata.retrievedAt},now);
          else if(target.state==="AK") {
            const issue=alaskaProfileIssue(body,url);if(issue)throw new Error(issue);
          }
          else {
            const parsed = parseOfficialRoster(target,[{url,body,retrievedAt:metadata.retrievedAt}],metadata.retrievedAt);
            if (!parsed.officeholders.length && !parsed.vacancies?.length) throw new Error("No current official identities or vacancies parsed.");
          }
        } catch(error) {
          throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID",`${target.publisher} roster could not be parsed: ${error instanceof Error?error.message:String(error)}`);
        }
      },
    });
    const body = new TextDecoder("utf-8",{fatal:true}).decode(release.bytes);
    return {document:{url,body,retrievedAt:release.retrievedAt,checkedAt:release.checkedAt},acquisition:{requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,
      httpStatus:release.httpStatus,body,retrievedAt:release.retrievedAt,rawHash:release.sha256,sourceCheck:knownReleaseSourceCheck(release),
      ...(release.vaultKey?{vaultKey:release.vaultKey}:{})} satisfies StatePeopleAcquisition,
      conditional:!!release.etag || !!release.lastModified};
  };
  const pooled=await runBoundedWorkPool(routes,8,async url=>{
    try {return {status:"fulfilled" as const,value:await work(url)};}
    catch(reason){return {status:"rejected" as const,reason};}
  });
  const results=pooled.map(result=>result.ok?result.value:{status:"rejected" as const,reason:new Error(result.error)});
  for (let index=0;index<results.length;index++) {
    const result = results[index]!;
    if (result.status==="fulfilled") {
      documents.push(result.value.document); acquisitions.push(result.value.acquisition);
      if (!result.value.conditional) gaps.push({sourceUrl:routes[index]!,detail:"The publisher supplies no ETag or Last-Modified date; a read must compare the returned bytes to the held source."});
    } else {
      input.signal.throwIfAborted();
      if (result.reason instanceof RepositoryLockHeld) throw result.reason;
      gaps.push({sourceUrl:routes[index]!,detail:result.reason instanceof Error?result.reason.message:String(result.reason)});
    }
  }
  let roster: OfficeholderSet = {scope:target.state?target.jurisdiction:"us",generatedAt:now,officeholders:[],divisions:[],unmatched:[],currentMembershipComplete:false,coveredChambers:[]};
  const hasRoster = target.kind==="senate" ? documents.some(row=>row.url===SENATE_ROSTER_URL)
    : target.kind==="house" ? documents.some(row=>row.url===HOUSE_ROSTER_URL) : documents.length>0;
  if (hasRoster) {
    try { roster=parseOfficialRoster(target,documents,documents.map(row=>row.retrievedAt!).sort().at(-1) ?? now); }
    catch(error) { gaps.push({sourceUrl:target.routes[0]!,detail:error instanceof Error?error.message:String(error)}); }
  }
  if (!roster.currentMembershipComplete) gaps.push({sourceUrl:target.routes[0]!,detail:"The current source did not enumerate every roster seat; omitted people remain held until an exact official departure or a complete roster confirms the change."});
  const releaseId=createHash("sha256").update(JSON.stringify(acquisitions.map(row=>[row.requestedUrl,row.rawHash]))).digest("hex");
  return {target,releaseId,roster,acquisitions,gaps,complete:roster.currentMembershipComplete===true};
}
