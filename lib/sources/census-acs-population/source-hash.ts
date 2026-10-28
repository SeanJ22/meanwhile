import { createHash } from "node:crypto";
import { sourceContentHash } from "../../civic-data/source-hash.ts";
import { canonicalCivicDataHash } from "../../civic-data/canonical-hash.ts";
import type { SourceProbeDependencies } from "../../civic-data/source-probe.ts";
import type { AcsNationalSources } from "./national.ts";

export interface AcsSourceProbe {
  readonly formatVersion:1;
  readonly complete:true;
  readonly release:AcsNationalSources["release"];
  readonly dependencies:SourceProbeDependencies;
  readonly referenceHashes:Readonly<Record<string,string>>;
  readonly requests:readonly {readonly scope:string;readonly requestedUrl:string;readonly finalUrl:string;readonly httpStatus:number;readonly rawHash:string}[];
}
export function acsSourceProbe(sources:AcsNationalSources,dependencies:SourceProbeDependencies,referenceHashes:Readonly<Record<string,string>>):AcsSourceProbe {
  return {formatVersion:1,complete:true,release:sources.release,dependencies,referenceHashes,requests:sources.captures.map(capture=>({
    scope:capture.scope,requestedUrl:capture.url,finalUrl:capture.finalUrl??capture.url,httpStatus:capture.status,
    rawHash:canonicalSourceBytes(capture.rawText??JSON.stringify(capture.rows)),
  })).sort((a,b)=>a.requestedUrl.localeCompare(b.requestedUrl))};
}
// Exact response text, not the observation-bearing normalized table envelope.
const canonicalSourceBytes=(body:string)=>createHash("sha256").update(body).digest("hex");

export function acsSourceContentHash(probe:AcsSourceProbe):string {
  return sourceContentHash(probe.requests.map(request=>({...request,capture:{rawHash:request.rawHash},
    request:{scope:request.scope,httpStatus:request.httpStatus}})),{parserVersion:"census-data-api/3",schemaVersion:"B01003_001E+B01003_001M",
    release:probe.release,dependencies:probe.dependencies,referenceHashes:probe.referenceHashes});
}
export const acsSourceContext=(value:unknown)=>canonicalCivicDataHash(value);
