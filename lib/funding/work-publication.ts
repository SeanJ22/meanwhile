import {createHash} from "node:crypto";
import type {RoutineDataStore} from "../civic-data/store.ts";
import type {EvidenceStore} from "../control-plane/evidence/store.ts";
import type {CampaignFinanceWorkCheck} from "./state-sources.ts";
import type {RoutineCandidate} from "../civic-data/types.ts";
import type {DerivedInputRef} from "../civic-data/derived-authority.ts";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function publishCampaignMoneyWork(store:RoutineDataStore,vault:EvidenceStore,scope:string,report:CampaignFinanceWorkCheck,at:string){
  const [{canonicalCivicDataJson},{derivedRetrieval},{derivedRequestedUrl},{processRegisteredRoutineCandidate},{sourceProjectionEvidence},{CAMPAIGN_MONEY_SOURCE_ID,CAMPAIGN_FINANCE_PARSER}]=await Promise.all([
    import("../civic-data/changes.ts"),import("../civic-data/derived-authority.ts"),import("../civic-data/derived-door.ts"),
    import("../civic-data/promotion.ts"),import("../civic-data/types.ts"),import("./state-sources.ts"),
  ]);
  const text=canonicalCivicDataJson(report),body=new TextEncoder().encode(text),rawHash=hash(text),artifactId=`project/meanwhile/campaign-money/work/${rawHash}`;
  await vault.put(artifactId,body,{contentHash:`sha256-${rawHash}`,contentType:"application/json",byteLength:body.length});
  const inputs:DerivedInputRef[]=[{kind:"VAULTED_EVIDENCE",artifactId,contentHash:`sha256-${rawHash}`,tier:"SANITIZED_DERIVED",retrievedAt:at}];
  const derived=derivedRetrieval(inputs),sourceId=CAMPAIGN_MONEY_SOURCE_ID;
  const candidate:RoutineCandidate={id:`cv-${hash(`${scope}:${rawHash}:${at}`).slice(0,32)}`,sourceId,recordClass:"CAMPAIGN_FINANCE",scope,
    sourceProjectionEvidence:sourceProjectionEvidence(sourceId,"CAMPAIGN_FINANCE",scope),
    retrieval:{succeeded:true,requestedUrl:derivedRequestedUrl(sourceId,scope),finalUrl:null,httpStatus:null,retrievedAt:derived.retrievedAt!,rawHash:derived.rawHash,derived:{inputs}},
    normalization:{succeeded:true,parserVersion:CAMPAIGN_FINANCE_PARSER,schemaVersion:CAMPAIGN_FINANCE_PARSER,normalizedHash:rawHash,normalizedPayloadHash:rawHash,inputRecords:1,outputRecords:1,droppedRecords:0,missingRequiredFields:[]},
    identities:[{subjectId:report.records[0].id,jurisdiction:report.state==="US"?"US":`US-${report.state}`,identifiers:{source_record_id:report.records[0].id},matchBasis:"EXACT_SCOPED_ID",ambiguous:false}],
    temporal:{version:at,expectedVersion:at,sourceThrough:at,staleAtRetrieval:false},
    semantics:{factKind:"Campaign money work completed for the published people read in this pass",violations:[]},
    horizon:{kind:"OPEN_FACT_SET",query:scope,returnedRecords:1,declaredTotal:null,paginationComplete:true,claimsComplete:false},
    absence:{claimsAbsence:false,basis:"NONE",exactSubject:null,exactHorizon:null},dependentChecks:[{consumer:"Campaign refresh clock",passed:true,detail:"The saved state report records completed work and remaining gaps; it asserts no missing filing is absent."}],
    normalizedPayload:report,readModel:report};
  const outcome=await processRegisteredRoutineCandidate(store,sourceId,candidate,at,undefined,{vault});
  if(!outcome.promoted&&!outcome.confirmed)throw new Error(outcome.candidate.failureDetail??"Campaign work check was refused");
  return {candidate,outcome};
}
