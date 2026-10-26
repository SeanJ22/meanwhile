/** Refresh one state's sourced registration through its ordinary promotion door. */
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { routineReceiptFields } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { SourceCheckEvidence } from "../lib/civic-data/types.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { acquireRegistrationSource, heldRegistrationReceipt, registrationSourceCheck, type RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { registrationTarget, type RegistrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { registrationReferenceFromRelease, registrationReferenceWithPublished } from "../lib/registration/source-reference.ts";
import { acquireSchoolRelease, applyF33NativeCrosswalk, NCES_DIRECTORY, schoolListingsFromRelease } from "../lib/registration/school-sources.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";
import { knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { reconcileRegistrationHeldReceipt } from "../lib/registration/held-evidence.ts";
import { REGISTRATION_PARSER_VERSION,REGISTRATION_SOURCE_ID } from "../lib/registration/publication.ts";
import { registrationSourceContentHash,registrationSourceProbe,type RegistrationSourceProbe } from "../lib/registration/source-hash.ts";
import { confirmSourceHashUnchanged,sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";

export function parseRegistrationArguments(args: readonly string[]): { readonly target: RegistrationTarget } {
  const states = args.filter((value) => value.startsWith("--state="));
  const unknown = args.filter((value) => value !== "--promote" && !value.startsWith("--state="));
  if (!args.includes("--promote")) throw new Error("REGISTRATION_PROMOTE_FLAG_REQUIRED: the runner invokes this with --promote.");
  if (states.length !== 1 || unknown.length > 0) throw new Error("REGISTRATION_ARGUMENTS_INVALID: exactly one --state=XX and --promote.");
  return { target: registrationTarget(states[0].slice("--state=".length)) };
}

async function main(): Promise<void> {
  const { target } = parseRegistrationArguments(process.argv.slice(2));
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  const head=await store.readSourceHead("REGISTRATION",target.scope);
  const reference=loadRegistrationReference(process.cwd(),target.state);
  const heldReceipt=heldRegistrationReceipt();
  // Publish evidence already held before checking the publisher. Fresh access
  // is not a prerequisite for first-use delivery or a changed parser.
  if (!head) {
    const held = registrationCandidate({ target, reference, receipt: heldReceipt, previous:null });
    const delivery = await processRegisteredRoutineCandidate(store, target.contractId, held, new Date().toISOString());
    if (!delivery.promoted) throw new Error(`REGISTRATION_HELD_PUBLICATION_REFUSED:${delivery.candidate.receipt?.decision ?? "unknown"}`);
  }

  let confirmedBy: RegistrationSourceReceipt["confirmedBy"] = "HELD_RELEASE";
  const capabilityGaps: string[] = [];
  const schoolChecks: SourceCheckEvidence[] = [];
  const schools=new Map<string,KnownRelease>();
  let receipt = heldReceipt;
  let sourceFailure: unknown;
  let sourceFailedAt: string | undefined;
  let sourceFailureUrl = receipt.requestedUrl;
  try {
    receipt = await withPublisherAcquisitionDeadline("Census of Governments (2022)", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, (signal) => acquireRegistrationSource({ signal }));
    confirmedBy = receipt.confirmedBy;
  } catch (error) {
    sourceFailure = error;
    sourceFailedAt = new Date().toISOString();
    capabilityGaps.push(`Census government release: ${error instanceof Error ? error.message : String(error)}`);
  }
  // These inventories publish independently: a refused government download
  // cannot discard available education-agency evidence (or vice versa).
  for (const kind of ["lea-directory", "f33"] as const) {
    let schoolUrl = NCES_DIRECTORY;
    try {
      const release = await withPublisherAcquisitionDeadline(`NCES ${kind}`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, signal => acquireSchoolRelease(kind, { signal,
        onSourceUrl: url => { schoolUrl = url; } }));
      schools.set(kind,release);
      schoolChecks.push(knownReleaseSourceCheck(release));
    } catch (error) {
      const detail = `NCES ${kind}: ${error instanceof Error ? error.message : String(error)}`;
      capabilityGaps.push(detail);
      if (kind === "lea-directory" && !sourceFailure) {
        sourceFailure = isSourceAcquisitionFailure(error) ? error : sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", detail);
        sourceFailedAt = new Date().toISOString();
        sourceFailureUrl = schoolUrl;
      }
    }
  }
  const probe=registrationSourceProbe({referenceSha256:reference.sha256,receipt,schools,
    complete:!capabilityGaps.length&&!!receipt.release&&!receipt.release.outage&&schools.size===2&&[...schools.values()].every(release=>!release.outage)});
  const priorProbe=head?.parserVersion===REGISTRATION_PARSER_VERSION&&head.rawHashBasis==="SOURCE_CONTENT_V1"
    ?await store.readCandidatePath<RegistrationSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]):null;
  if(probe.complete&&priorProbe?.complete) {
    const rawHash=registrationSourceContentHash(probe);
    const confirmation=await confirmSourceHashUnchanged({store,sourceId:REGISTRATION_SOURCE_ID,recordClass:"REGISTRATION",scope:target.scope,
      parserVersion:REGISTRATION_PARSER_VERSION,rawHash,complete:true,now:new Date().toISOString(),retrieval:{requestedUrl:receipt.requestedUrl,
        finalUrl:receipt.finalUrl,httpStatus:200,retrievedAt:receipt.retrievedAt,rawHash,sourceCheck:registrationSourceCheck(receipt,schoolChecks)}});
    if(confirmation){console.log("RCD_RECEIPT="+JSON.stringify({source:target.contractId,...sourceHashReceiptFields(confirmation),confirmedBy,
      capabilityGaps,structuralReleaseContract:ZERO_RELEASE_EVENTS}));return;}
  }
  const previousPromotion=await store.readPromotion<RegistrationReadModel>("REGISTRATION",target.scope),previous=previousPromotion?.payload??null;
  let refreshed=registrationReferenceWithPublished(reference,previous);
  if(receipt.release)refreshed=registrationReferenceFromRelease(refreshed,receipt.release);
  else if(previousPromotion&&!previous?.governments) {
    const metadata=await store.readPublishedCandidateMetadata(previousPromotion.versionId);
    const normalizedPayload=await store.readCandidatePath(previousPromotion.versionId,["normalizedPayload"]);
    const previousHead=head?.versionId===previousPromotion.versionId?head:await store.readSourceHead("REGISTRATION",target.scope);
    if(metadata&&previousHead)receipt=reconcileRegistrationHeldReceipt(receipt,refreshed,{...metadata,
      candidate:{...metadata.candidate,normalization:{parserVersion:previousHead.parserVersion},readModel:previous,normalizedPayload}});
  }
  for(const [kind,release]of schools)try {
    const listings=referenceGovernmentListings(refreshed);
    if(kind==="lea-directory"){
      const updated=new Map(listings.map(row=>[row.id,row]));
      for(const row of schoolListingsFromRelease(refreshed,release))updated.set(row.id,row);
      refreshed={...refreshed,listings:[...updated.values()]};
    } else refreshed={...refreshed,listings:applyF33NativeCrosswalk(listings,release)};
  } catch(error){
    const detail=`NCES ${kind}: ${error instanceof Error?error.message:String(error)}`;capabilityGaps.push(detail);
    if(kind==="lea-directory"&&!sourceFailure){sourceFailure=isSourceAcquisitionFailure(error)?error:sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID",detail);
      sourceFailedAt=new Date().toISOString();sourceFailureUrl=release.requestedUrl;}
  }
  const sourceProbe={...probe,complete:probe.complete&&!capabilityGaps.length};
  const candidate = registrationCandidate({ target, reference: refreshed,
    receipt: { ...receipt, sourceCheck: registrationSourceCheck(receipt, schoolChecks) }, previous,sourceProbe });
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, new Date().toISOString(),previousPromotion?.versionId??null,
    {confirmUnchanged:priorProbe?.formatVersion===1&&priorProbe.complete===sourceProbe.complete});
  if (sourceFailure && isSourceAcquisitionFailure(sourceFailure)) {
    // Publish independent held evidence first, then record the failed provider
    // attempt against that LKG. Exactly one terminal receipt belongs to this run.
    const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: target.contractId, failure: sourceFailure,
      attemptedAt: sourceFailedAt, requestedUrl: sourceFailureUrl });
    console.log("RCD_RECEIPT=" + JSON.stringify({ ...failed.receipt, confirmedBy, capabilityGaps,
      coverage: (candidate.readModel as RegistrationReadModel).counts }));
    process.exitCode = 2;
    return;
  }
  const counts = (candidate.readModel as RegistrationReadModel).counts;
  console.log(
    "RCD_RECEIPT=" +
      JSON.stringify({
        source: target.contractId,
        ...routineReceiptFields(candidate, outcome),
        confirmedBy,
        coverage: counts,
        capabilityGaps,
        structuralReleaseContract: ZERO_RELEASE_EVENTS,
      }),
  );
  if (!outcome.promoted&&!outcome.confirmed) process.exitCode = 2;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/registration-refresh.mts");
if (invokedDirectly) await main();
