import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { readSourceProbeDependencies, type SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import { REGISTRATION_RECORD_CLASS, registrationTarget } from "../../registration/publication.ts";
import { OPEN_DATA_PARSER, type OpenDataSource } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";

type SourceRequest = Pick<OpenDataCapture,"url"|"rawHash"|"archive">;
/** The same ordinary sourceProbe metadata as people sources: exact request content and upstream pointer inputs. */
export interface OpenDataSourceProbe {
  readonly formatVersion:1;
  readonly sourceId:OpenDataSource;
  readonly parserVersion:string;
  readonly complete:boolean;
  readonly dependencies:SourceProbeDependencies;
  readonly requests:readonly SourceRequest[];
}
export function openDataSourceContentHash(captures:readonly SourceRequest[],inputs:unknown=null):string {
  const records=[...new Set(captures.map(capture=>canonicalCivicDataJson([capture.url,capture.rawHash,capture.archive??null])))].sort();
  return createHash("sha256").update(canonicalCivicDataJson({inputs,records})).digest("hex");
}
export function openDataProbeContentHash(probe:OpenDataSourceProbe):string {
  return openDataSourceContentHash(probe.requests,{parserVersion:probe.parserVersion,dependencies:probe.dependencies});
}
export function readOpenDataSourceDependencies(store:Pick<RoutineDataStore,"readSourceHead">):Promise<SourceProbeDependencies> {
  return readSourceProbeDependencies(store,US_JURISDICTIONS.map(state=>({recordClass:REGISTRATION_RECORD_CLASS,scope:registrationTarget(state.usps).scope})));
}
export function openDataSourceProbe(input:{sourceId:OpenDataSource;captures:readonly OpenDataCapture[];dependencies:SourceProbeDependencies;complete:boolean}):OpenDataSourceProbe {
  return {formatVersion:1,sourceId:input.sourceId,parserVersion:OPEN_DATA_PARSER,complete:input.complete,dependencies:input.dependencies,
    requests:input.captures.map(({url,rawHash,archive})=>({url,rawHash,...(archive?{archive}:{})}))};
}
