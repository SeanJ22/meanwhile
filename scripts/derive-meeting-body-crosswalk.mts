/**
 * **THE AUTOMATIC CALENDAR-TO-BODY RECORDS, REVIEWED BY THE STANDING RUNNER
 * FROM WHAT IS ALREADY PROMOTED OR VAULTED.** (C16 option A, 2026-09-25.)
 *
 *   node --experimental-strip-types scripts/derive-meeting-body-crosswalk.mts --promote
 *
 * The standing runner's child for the `meeting-body-crosswalk-derived` routine
 * contract. It fetches nothing from any publisher and calls no model. It reads:
 *
 * - the promoted automatic crosswalk it succeeds (every accepted row is carried
 *   unless a later review of a newer walk renews it);
 * - the discovery walk's newest attempt for every government whose newest walk
 *   FOUND a route, from the control plane's attempt log (read only);
 * - each of those governments' states' promoted registration: which body the
 *   government is;
 * - the evidence vault, read only (`lib/control-plane/evidence/read-only-vault.ts`):
 *   the calendar bytes each walk confirmed, and the pages it saved.
 *
 * Each walk is reviewed by `reviewDiscoveryWalk` (lib/control-plane/discovery/
 * auto-crosswalk.ts), whose reviewer id is the digest of its own code: every
 * accepted row passes every C16 row check on vaulted bytes, and everything
 * else is held by name with who moves next. The version is planned by
 * `planDerivedCrosswalk` and promoted through
 * `processRegisteredRoutineCandidate`, whose door checks every promoted input
 * against the store. Anything it cannot read refuses the candidate by name and
 * leaves the last known good rows live. The wiring derive reads these rows
 * beside the reviewed crosswalk on its next pass.
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  DERIVED_CROSSWALK_CONTRACT_ID,
  DERIVED_CROSSWALK_RECORD_CLASS,
  DERIVED_CROSSWALK_SCOPE,
  derivedCrosswalkCandidate,
  derivedCrosswalkFailedCandidate,
  planDerivedCrosswalk,
  readDerivedMeetingBodyCrosswalk,
  type AutoCrosswalkReview,
} from "../lib/civic-data/derived-crosswalk.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { AUTO_CROSSWALK_VENDORS, autoCrosswalkReviewerId, reviewDiscoveryWalk, type HeldBytes, type RegisteredGovernment } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { CURRENT_CALENDAR_READS_SQL } from "../lib/control-plane/discovery/derived-wiring.ts";
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { indexVault, readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { digestValueClosure } from "../lib/ops/generator-digest.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference, type LoadedReference } from "../lib/registration/reference.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-meeting-body-crosswalk.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
/** The reviewer is named by its own code: a change to the review re-keys every row it accepts from then on. */
const REVIEWER = autoCrosswalkReviewerId(digestValueClosure(process.cwd(), "lib/control-plane/discovery/auto-crosswalk.ts").digest);
/** The vendors whose finds the reviewer reads; a walk whose finds are all others still has them held by name. */

async function finish(candidate: RoutineCandidate): Promise<void> {
  const outcome = await processRegisteredRoutineCandidate(store, DERIVED_CROSSWALK_CONTRACT_ID, candidate, now);
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: DERIVED_CROSSWALK_CONTRACT_ID,
    candidateId: candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  if (!outcome.promoted) process.exitCode = 2;
}

async function main(): Promise<void> {
  const lkg = await readDerivedMeetingBodyCrosswalk({ store, bypassCache: true, now });
  if (lkg.kind === "STORE_UNREACHABLE") {
    await finish(derivedCrosswalkFailedCandidate(now, `The previous automatic crosswalk could not be read (${lkg.code}): ${lkg.detail}`));
    return;
  }
  const previous = lkg.kind === "PROMOTED" ? lkg.value.records : [];
  const lkgInput = lkg.kind === "PROMOTED"
    ? promotedInputRef(DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE, lkg.metadata.versionId, lkg.value, lkg.metadata.promotedAt)
    : null;

  /* Each route's newest actual read, with the original walk and saved evidence. */
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) {
    await finish(derivedCrosswalkFailedCandidate(now, "The control plane's attempt log is not configured (WTP_CONTROL_PLANE_DATABASE_URL), so no walk can be read."));
    return;
  }
  let walks: { attempt: MeetingsDiscoveryAttempt; recordId: string; recordedAt: string; routes: string[] }[];
  try {
    const sql = neon(controlPlane);
    const found = await sql.query(
      CURRENT_CALENDAR_READS_SQL, [null],
    ) as { id: string; position: number | string; value: MeetingsDiscoveryAttempt; routes: string[] }[];
    walks = found.map((row) => ({ attempt: row.value, recordId: String(row.position), recordedAt: row.value.finishedAt, routes: row.routes }));
  } catch (error) {
    await finish(derivedCrosswalkFailedCandidate(now, `The discovery-attempt log could not be read: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  /* Registration: which body each government is, per state. An unreadable state holds its governments by name. */
  const reviewed = await readRegistryRuntimeProjection({ store, bypassCache: true, now });
  const reviewedInput = reviewed.kind === "PROMOTED"
    ? promotedInputRef("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, reviewed.metadata.versionId, reviewed.value, reviewed.metadata.promotedAt)
    : null;
  const registrations = new Map<string, {
    readonly input: DerivedInputRef;
    readonly bodies: ReadonlyMap<string, RegisteredGovernment>;
    readonly reference: LoadedReference;
    readonly reviewedRegistryVersionId: string;
  } | { readonly unread: string }>();
  for (const state of new Set(walks.map((w) => w.attempt.stateCode.toUpperCase()))) {
    try {
      const read = await readRegistrationProjection(state, { store, bypassCache: true, now });
      const input = read.kind === "PROMOTED" ? promotedInputRef("REGISTRATION", read.metadata.scope, read.metadata.versionId, read.value, read.metadata.promotedAt) : null;
      if (read.kind !== "PROMOTED" || input === null) {
        registrations.set(state, { unread: `${state} registration is ${read.kind}` });
        continue;
      }
      const reference = loadRegistrationReference(process.cwd(), state);
      if (reference.sha256 !== read.value.vintage.referenceSha256) {
        registrations.set(state, { unread: `${state} registration does not name the committed Census government pairing` });
        continue;
      }
      const labels = new Map(read.value.divisions.map((d) => [d.ocdId, d.label] as const));
      const bodies = new Map<string, RegisteredGovernment>();
      for (const body of read.value.bodies) {
        if (body.jurisdictionId === null || bodies.has(body.jurisdictionId)) continue;
        bodies.set(body.jurisdictionId, { bodyId: body.id, ocdId: body.ocdId, publishingOrg: labels.get(body.ocdId) ?? body.jurisdictionId, input });
      }
      registrations.set(state, { input, bodies, reference, reviewedRegistryVersionId: read.value.reviewedRegistryVersionId });
    } catch (error) {
      registrations.set(state, { unread: `${state} registration could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /* The vault, read only: every body the reviewed walks saved, read once. */
  const vault = await indexVault(join(process.cwd(), "data", "control-plane", "vault"));
  const held = new Map<string, HeldBytes>();
  const cite = async (artifactId: string | null): Promise<void> => {
    if (artifactId === null || held.has(artifactId)) return;
    const artifact: HeldVaultArtifact | undefined = vault.byId.get(artifactId);
    if (artifact === undefined || artifact.tier === "RESTRICTED_RAW") return;
    try {
      const text = new TextDecoder().decode(await readHeldBytes(artifact));
      held.set(artifactId, {
        text,
        sha256: artifact.contentHash.slice("sha256-".length),
        evidence: {
          kind: "VAULTED_EVIDENCE",
          artifactId: artifact.id,
          contentHash: artifact.contentHash,
          tier: artifact.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW",
          retrievedAt: artifact.retrievedAt ?? now,
        },
      });
    } catch {
      /* A body that does not hash to its commitment is not held: the reviewer holds its row as not vaulted. */
    }
  };
  const reviews: AutoCrosswalkReview[] = [];
  for (const walk of walks) {
    if (!walk.attempt.found.some((f) => AUTO_CROSSWALK_VENDORS.has(f.vendor))) continue;
    for (const f of walk.attempt.found) await cite(f.artifactId);
    for (const s of walk.attempt.steps) if (s.status !== null && s.status >= 200 && s.status < 300) await cite(s.artifactId);
    const state = walk.attempt.stateCode.toUpperCase();
    const registration = registrations.get(state);
    const registered = registration === undefined
      ? { notRegistered: `no registration was read for ${state}` }
      : "unread" in registration
        ? { notRegistered: registration.unread }
        : registration.bodies.get(walk.attempt.jurisdictionId) ?? (() => {
            if (reviewed.kind !== "PROMOTED" || reviewedInput === null) {
              return { notRegistered: `${state} registration omits the body and the reviewed registry is ${reviewed.kind}` };
            }
            if (registration.reviewedRegistryVersionId !== reviewed.metadata.versionId) {
              return { notRegistered: `${state} registration and reviewed registry name different identity versions` };
            }
            const resolved = reviewedBodyForGovernment(
              registration.reference, walk.attempt.jurisdictionId, reviewed.value.registry.bodies,
            );
            return resolved === null
              ? { notRegistered: `${state} registration and reviewed registry do not pair ${walk.attempt.jurisdictionId} with one exact governing body` }
              : { ...resolved, input: reviewedInput };
          })();
    reviews.push(reviewDiscoveryWalk({
      walk,
      routes: walk.routes,
      registered,
      held: (artifactId) => held.get(artifactId) ?? null,
      handWired: (bodyId) => SOURCE_WIRING.some((wiring) => wiring.bodyId === bodyId),
      reviewer: REVIEWER,
      now,
    }));
  }

  const plan = planDerivedCrosswalk({ previous, reviews });
  for (const id of plan.accepted) console.log(`  accepted ${id}`);
  for (const id of plan.renewed) console.log(`  renewed ${id}`);
  for (const h of plan.held) console.log(`  held ${h.jurisdictionId} ${h.route}${h.bodyName ? ` (${h.bodyName})` : ""}: ${h.reason}: ${h.detail}`);
  await finish(derivedCrosswalkCandidate(plan, [
    ...(lkgInput === null ? [] : [lkgInput]),
    ...[...registrations.values()].flatMap((entry) => "input" in entry ? [entry.input] : []),
  ], now));
}

await main();
