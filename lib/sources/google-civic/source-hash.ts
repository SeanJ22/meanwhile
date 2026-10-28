import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { sourceContentHash } from "../../civic-data/source-hash.ts";
import { GOOGLE_CIVIC_API,GOOGLE_CIVIC_ELECTION_DAY,GOOGLE_CIVIC_PARSER_VERSION } from "./targets.ts";

export interface CivicSourceProbe {
  readonly formatVersion:1;
  readonly catalogHash:string;
  readonly inputHash:string;
  readonly responseHash:string;
  readonly complete:boolean;
  readonly representedCounties?:readonly string[];
  readonly representedStates?:readonly string[];
}
export const civicInputHash=(value:unknown)=>createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");
export const civicBytesHash=(value:string)=>createHash("sha256").update(value).digest("hex");
export function civicSourceContentHash(probe:CivicSourceProbe):string {
  return sourceContentHash([{requestedUrl:`${GOOGLE_CIVIC_API}elections`,finalUrl:`${GOOGLE_CIVIC_API}elections`,capture:{rawHash:probe.catalogHash}}],
    {parserVersion:GOOGLE_CIVIC_PARSER_VERSION,electionDay:GOOGLE_CIVIC_ELECTION_DAY,inputHash:probe.inputHash,responseHash:probe.responseHash});
}
