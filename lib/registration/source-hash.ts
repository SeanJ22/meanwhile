import { sourceContentHash } from "../civic-data/source-hash.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import type { KnownRelease } from "../sources/known-release.ts";
import type { RegistrationSourceReceipt } from "./acquire.ts";
import { REGISTRATION_PARSER_VERSION,REGISTRATION_SCHEMA_VERSION } from "./publication.ts";
import type { RegistrationReadModel } from "./candidate.ts";
import type { RegistryProvenance } from "../registry/types.ts";

export interface RegistrationSourceProbe {
  readonly formatVersion:1;
  readonly complete:boolean;
  readonly acquisitionComplete?:boolean;
  readonly coverageComplete?:boolean;
  readonly referenceSha256:string;
  readonly requests:readonly {kind:string;requestedUrl:string;finalUrl:string;rawHash:string;retrievedAt:string;sourceCheck?:SourceCheckEvidence}[];
}
export function registrationSourceProbe(input:{referenceSha256:string;receipt:RegistrationSourceReceipt;schools:ReadonlyMap<string,KnownRelease>;
  complete:boolean}):RegistrationSourceProbe {
  return {formatVersion:1,complete:input.complete,acquisitionComplete:input.complete,referenceSha256:input.referenceSha256,
    requests:[{kind:"census-governments",requestedUrl:input.receipt.requestedUrl,finalUrl:input.receipt.finalUrl,rawHash:input.receipt.sha256,retrievedAt:input.receipt.retrievedAt,
      ...(input.receipt.sourceCheck?{sourceCheck:input.receipt.sourceCheck}:{})},
    ...[...input.schools].map(([kind,release])=>({kind,requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,rawHash:release.sha256,retrievedAt:release.sourceObservedAt,
      sourceCheck:{requestedUrl:release.requestedUrl,finalUrl:release.finalUrl,rawHash:release.sha256,checkedAt:release.checkedAt,httpStatus:release.lastCheckStatus as 200|304}}))]};
}
/** Missing native rows and independently held contact/domain evidence keep their own source dates. */
export function registrationSourcesCover(model:RegistrationReadModel,probe:RegistrationSourceProbe):boolean {
  const checked=(provenance:RegistryProvenance)=>!!provenance.rawHash&&probe.requests.some(request=>request.rawHash===provenance.rawHash&&
    [request.requestedUrl,request.finalUrl].includes(provenance.sourceUrl??""));
  return (model.governments??[]).every(government=>{
    const fixedGeography=/:tiger:|:aiannh:|:boundary:/.test(government.id);
    return (fixedGeography||checked(government.provenance))&&
      (government.additionalSources??[]).every(checked)&&Object.values(government.contactProvenance??{}).every(row=>!!row&&checked(row))&&
      !(government.govDomains?.length);
  });
}
export function registrationProbePages(probe:RegistrationSourceProbe) {
  return probe.requests.map(request=>({...request,httpStatus:200,capture:{rawHash:request.rawHash}}));
}
export function registrationSourceContentHash(probe:RegistrationSourceProbe):string {
  return sourceContentHash(probe.requests.map(request=>({...request,capture:{rawHash:request.rawHash},request:{kind:request.kind}})),
    {referenceSha256:probe.referenceSha256,parserVersion:REGISTRATION_PARSER_VERSION,schemaVersion:REGISTRATION_SCHEMA_VERSION});
}
