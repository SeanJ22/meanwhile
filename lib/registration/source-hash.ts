import { sourceContentHash } from "../civic-data/source-hash.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import type { KnownRelease } from "../sources/known-release.ts";
import type { RegistrationSourceReceipt } from "./acquire.ts";
import { REGISTRATION_PARSER_VERSION,REGISTRATION_SCHEMA_VERSION } from "./publication.ts";

export interface RegistrationSourceProbe {
  readonly formatVersion:1;
  readonly complete:boolean;
  readonly referenceSha256:string;
  readonly requests:readonly {kind:string;requestedUrl:string;finalUrl:string;rawHash:string;sourceCheck?:SourceCheckEvidence}[];
}
export function registrationSourceProbe(input:{referenceSha256:string;receipt:RegistrationSourceReceipt;schools:ReadonlyMap<string,KnownRelease>;
  complete:boolean}):RegistrationSourceProbe {
  return {formatVersion:1,complete:input.complete,referenceSha256:input.referenceSha256,
    requests:[{kind:"census-governments",requestedUrl:input.receipt.requestedUrl,finalUrl:input.receipt.finalUrl,rawHash:input.receipt.sha256,
      ...(input.receipt.sourceCheck?{sourceCheck:input.receipt.sourceCheck}:{})},
    ...[...input.schools].map(([kind,release])=>({kind,requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,rawHash:release.sha256}))]};
}
export function registrationSourceContentHash(probe:RegistrationSourceProbe):string {
  return sourceContentHash(probe.requests.map(request=>({...request,capture:{rawHash:request.rawHash},request:{kind:request.kind}})),
    {referenceSha256:probe.referenceSha256,parserVersion:REGISTRATION_PARSER_VERSION,schemaVersion:REGISTRATION_SCHEMA_VERSION});
}
