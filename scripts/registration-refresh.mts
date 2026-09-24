/**
 * **ONE STATE'S REGISTRATION, ON THE RUNNER'S CLOCK.** (2026-09-23.)
 *
 *   node --experimental-strip-types scripts/registration-refresh.mts --promote --state=OH
 *
 * The standing runner invokes this for each state's REGISTRATION contract
 * (`lib/civic-data/contracts.ts`). It confirms census.gov still serves the
 * pinned Census of Governments bytes, reads the state's committed reference
 * and the promoted reviewed registry, builds the candidate
 * (`lib/registration/candidate.ts`) and hands it to the promotion engine,
 * the one authorized door. It writes no file. A changed or unavailable Census
 * file records its reason and leaves the state's prior registration live; a
 * reviewed registry that cannot be read stops the run, because registering
 * without it could write an id the reviewed registry owns.
 */
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { acquireRegistrationSource } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";
import { registrationTarget, type RegistrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";

export function parseRegistrationArguments(args: readonly string[]): { readonly target: RegistrationTarget } {
  const states = args.filter((value) => value.startsWith("--state="));
  const unknown = args.filter((value) => value !== "--promote" && !value.startsWith("--state="));
  if (!args.includes("--promote")) throw new Error("REGISTRATION_PROMOTE_FLAG_REQUIRED: the runner invokes this with --promote.");
  if (states.length !== 1 || unknown.length > 0) throw new Error("REGISTRATION_ARGUMENTS_INVALID: exactly one --state=XX and --promote.");
  return { target: registrationTarget(states[0].slice("--state=".length)) };
}

async function reviewedRegistryIds(): Promise<ReviewedRegistryIds> {
  const result = await readRegistryRuntimeProjection({ bypassCache: true });
  if (result.kind !== "PROMOTED" || result.metadata.versionId === null) {
    throw new Error(`REGISTRATION_REVIEWED_REGISTRY_UNREAD: the promoted reviewed registry answered ${result.kind}; registering without it could write an id it owns.`);
  }
  const registry = result.value.registry;
  return {
    versionId: result.metadata.versionId,
    divisionIds: new Set(registry.divisions.map((d) => d.ocdId)),
    bodyIds: new Set(registry.bodies.map((b) => b.id)),
    bodyDivisionIds: new Set(registry.bodies.map((b) => b.ocdId).filter((id): id is string => typeof id === "string" && id !== "")),
  };
}

async function main(): Promise<void> {
  const { target } = parseRegistrationArguments(process.argv.slice(2));
  installNeonRequestDeadline();
  const handle = resolveProductionWriteHandle();
  process.env.DATABASE_URL = handle.connection;
  process.env.WTP_DB_ROLE = "production";
  process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
  assertWriteAllowed("a routine civic data candidate/version promotion");
  const store = new PostgresRoutineDataStore();

  let candidate: RoutineCandidate;
  try {
    const receipt = await withPublisherAcquisitionDeadline("Census of Governments (2022)", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, (signal) => acquireRegistrationSource({ signal }));
    candidate = registrationCandidate({
      target,
      reference: loadRegistrationReference(process.cwd(), target.state),
      receipt,
      reviewed: await reviewedRegistryIds(),
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
