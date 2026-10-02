/** Refresh one state's sourced registration through its ordinary promotion door. */
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { acquireRegistrationSource, type RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import { registrationTarget, type RegistrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";

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

  let candidate: RoutineCandidate;
  let confirmedBy: RegistrationSourceReceipt["confirmedBy"];
  try {
    const receipt = await withPublisherAcquisitionDeadline("Census of Governments (2022)", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, (signal) => acquireRegistrationSource({ signal }));
    confirmedBy = receipt.confirmedBy;
    candidate = registrationCandidate({
      target,
      reference: loadRegistrationReference(process.cwd(), target.state),
      receipt,
    });
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({ store, contractId: target.contractId, failure: error });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, candidate.retrieval.retrievedAt);
  const counts = (candidate.readModel as RegistrationReadModel).counts;
  console.log(
    "RCD_RECEIPT=" +
      JSON.stringify({
        source: target.contractId,
        candidateId: candidate.id,
        confirmedBy,
        coverage: counts,
        acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
        state: outcome.candidate.state,
        decision: outcome.candidate.receipt?.decision ?? null,
        promotedVersion: outcome.promoted?.versionId ?? null,
        lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
        structuralReleaseContract: ZERO_RELEASE_EVENTS,
      }),
  );
  if (!outcome.promoted) process.exitCode = 2;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/registration-refresh.mts");
if (invokedDirectly) await main();
