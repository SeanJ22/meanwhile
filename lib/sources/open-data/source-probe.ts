import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { readSourceProbeDependencies, type SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "../../registration/publication.ts";
import { OPEN_DATA_PARSER, type OpenDataSource } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";
import type { KnownRelease } from "../known-release.ts";

type SourceRequest = Pick<OpenDataCapture,"url"|"rawHash"|"archive">;
export interface SocrataDiscoveryRequest {
  readonly sourceId:"socrata-state-links"|"socrata-government-links";
  readonly releaseId:string;
  readonly requestedUrl:string;
  readonly finalUrl:string;
  readonly rawHash:string;
  readonly retrievedAt:string;
  readonly checkedAt:string;
  readonly httpStatus:200|304;
}
export const SOCRATA_DISCOVERY_VERSION="socrata-government-portals/1";
/** The same ordinary sourceProbe metadata as people sources: exact request content and upstream pointer inputs. */
export interface OpenDataSourceProbe {
  readonly formatVersion:1;
  readonly sourceId:OpenDataSource;
  readonly parserVersion:string;
  readonly complete:boolean;
  readonly dependencies:SourceProbeDependencies;
  readonly requests:readonly SourceRequest[];
  readonly discoveryVersion?:string;
  readonly discoveryRequests?:readonly SocrataDiscoveryRequest[];
}
export function openDataSourceContentHash(captures:readonly SourceRequest[],inputs:unknown=null):string {
  const records=[...new Set(captures.map(capture=>canonicalCivicDataJson([capture.url,capture.rawHash,capture.archive??null])))].sort();
  return createHash("sha256").update(canonicalCivicDataJson({inputs,records})).digest("hex");
}
export function openDataProbeContentHash(probe:OpenDataSourceProbe):string {
  return openDataSourceContentHash(probe.requests,{parserVersion:probe.parserVersion,dependencies:probe.dependencies,
    ...(probe.discoveryVersion?{discoveryVersion:probe.discoveryVersion,discoveryRequests:(probe.discoveryRequests??[]).map(request=>
      [request.sourceId,request.releaseId,request.requestedUrl,request.finalUrl,request.rawHash]).sort((a,b)=>canonicalCivicDataJson(a).localeCompare(canonicalCivicDataJson(b)))}:{})});
}
export function readOpenDataSourceDependencies(store:Pick<RoutineDataStore,"readSourceHead">):Promise<SourceProbeDependencies> {
  return readSourceProbeDependencies(store,US_JURISDICTIONS.map(state=>({recordClass:REGISTRATION_RECORD_CLASS,scope:registrationTarget(state.usps).scope})));
}
/** Credentials are reconstructed by the ordinary source acquire path; a probe plan stores no headers or secret queries. */
export function socrataDiscoveryRequest(release:Omit<KnownRelease,"bytes">):SocrataDiscoveryRequest|null {
  if(!["socrata-state-links","socrata-government-links"].includes(release.sourceId)||release.outage||
    ![200,304].includes(release.lastCheckStatus))return null;
  if([release.requestedUrl,release.finalUrl].some(address=>[...new URL(address).searchParams.keys()]
    .some(key=>/^(?:api[_-]?key|key|token|access[_-]?token|authorization|secret|password)$/i.test(key))))return null;
  return {sourceId:release.sourceId as SocrataDiscoveryRequest["sourceId"],releaseId:release.releaseId,requestedUrl:release.requestedUrl,
    finalUrl:release.finalUrl,rawHash:release.sha256,retrievedAt:release.retrievedAt,checkedAt:release.checkedAt,httpStatus:release.lastCheckStatus as 200|304};
}
export function openDataSourceProbe(input:{sourceId:OpenDataSource;captures:readonly OpenDataCapture[];dependencies:SourceProbeDependencies;complete:boolean;
  observations?:readonly Omit<KnownRelease,"bytes">[]}):OpenDataSourceProbe {
  const discovery=input.observations?.map(socrataDiscoveryRequest),requests=discovery?.filter((row):row is SocrataDiscoveryRequest=>row!==null);
  return {formatVersion:1,sourceId:input.sourceId,parserVersion:OPEN_DATA_PARSER,complete:input.complete,dependencies:input.dependencies,
    requests:input.captures.map(({url,rawHash,archive})=>({url,rawHash,...(archive?{archive}:{})})),
    ...(input.sourceId==="socrata-discovery"?{discoveryVersion:SOCRATA_DISCOVERY_VERSION,discoveryRequests:requests??[],
      complete:input.complete&&!!requests?.length&&requests.length===discovery?.length}:{})};
}
