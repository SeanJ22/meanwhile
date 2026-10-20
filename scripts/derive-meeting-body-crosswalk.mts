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
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { AUTO_CROSSWALK_VENDORS, autoCrosswalkReviewerId, reviewDiscoveryWalk, type HeldBytes, type RegisteredGovernment } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { CURRENT_CALENDAR_READS_SQL } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readCensusGovernmentFacts } from "../lib/registration/jurisdictions.ts";
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { heldArtifactCaptures } from "../lib/civic-data/held-artifact-captures.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { activeWiring } from "../lib/registry/source-wiring.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-meeting-body-crosswalk.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
// A body a hand-wired door already serves gets no derived row; without the doors, that cannot be told, so nothing is derived.
const doors = await ensureMeetingDoors();
if (!doors.ready) throw new Error(`MEETING_DOORS_UNREADABLE: ${doors.reason}`);

const AUTO_CROSSWALK_REVIEW_VERSION = "37f3d4f2533c";
const REVIEWER = autoCrosswalkReviewerId(AUTO_CROSSWALK_REVIEW_VERSION);

async function finish(candidate: RoutineCandidate): Promise<void> {
  const outcome = await processRegisteredRoutineCandidate(store, DERIVED_CROSSWALK_CONTRACT_ID, candidate, now);
  printSourceRunnerReceipt(DERIVED_CROSSWALK_CONTRACT_ID, candidate, outcome);
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
  const registrations = new Map<string, {
    readonly input: DerivedInputRef;
    readonly bodies: ReadonlyMap<string, RegisteredGovernment>;
    readonly reviewedStatus: string;
  } | { readonly unread: string }>();
  for (const state of new Set(walks.map((w) => w.attempt.stateCode.toUpperCase()))) {
    console.log(`RCD_PROGRESS meeting-body-crosswalk registration ${state}`);
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
      const census = readCensusGovernmentFacts(process.cwd(), [state]);
      const countyByPid = new Map((read.value.governments ?? []).map(government => [government.nativeIds.census_pid6, government.countyFips]));
      const bodies = new Map<string, RegisteredGovernment>();
      for (const body of read.value.bodies) {
        if (body.jurisdictionId === null || bodies.has(body.jurisdictionId)) continue;
        bodies.set(body.jurisdictionId, { bodyId: body.id, ocdId: body.ocdId, publishingOrg: labels.get(body.ocdId) ?? body.jurisdictionId,
          countyFips: body.censusId ? countyByPid.get(body.censusId) ?? census.byPid.get(body.censusId)?.countyFips ?? null : null, input });
      }
      const reviewed = await readRegistryRuntimeProjection([state], { store, bypassCache: true, now });
      const reviewedInput = reviewed.kind === "PROMOTED"
        ? promotedInputRef("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), reviewed.metadata.versionId, reviewed.value, reviewed.metadata.promotedAt)
        : null;
      if (reviewed.kind === "PROMOTED" && reviewedInput) {
        for (const walk of walks.filter(row => row.attempt.stateCode.toUpperCase() === state)) {
          if (bodies.has(walk.attempt.jurisdictionId)) continue;
          const resolved = reviewedBodyForGovernment(reference, walk.attempt.jurisdictionId, reviewed.value.registry.bodies);
          if (resolved) bodies.set(walk.attempt.jurisdictionId, { ...resolved, input: reviewedInput });
        }
      }
      registrations.set(state, { input, bodies, reviewedStatus: reviewed.kind });
    } catch (error) {
      registrations.set(state, { unread: `${state} registration could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /* The vault, read only: every body the reviewed walks saved, read once. */
  const capture = await heldArtifactCaptures(join(process.cwd(), "data", "control-plane", "vault"),
    walks.filter(({ attempt }) => attempt.found.some(row => AUTO_CROSSWALK_VENDORS.has(row.vendor)))
      .flatMap(({ attempt }) => [...attempt.found, ...attempt.steps].flatMap(row => row.artifactId ? [row.artifactId] : [])), controlPlane);
  const held = new Map<string, HeldBytes>();
  const cite = async (artifactId: string | null): Promise<void> => {
    if (artifactId === null || held.has(artifactId)) return;
    const artifact: HeldVaultArtifact | null = await capture(artifactId);
    console.log(`RCD_PROGRESS meeting-body-crosswalk capture ${artifactId}`);
    if (artifact === null || artifact.tier === "RESTRICTED_RAW") return;
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
    console.log(`RCD_PROGRESS meeting-body-crosswalk ${walk.attempt.jurisdictionId}`);
    if (!walk.attempt.found.some((f) => AUTO_CROSSWALK_VENDORS.has(f.vendor))) continue;
    for (const f of walk.attempt.found) await cite(f.artifactId);
    for (const s of walk.attempt.steps) if (s.status !== null && s.status >= 200 && s.status < 300) await cite(s.artifactId);
    const state = walk.attempt.stateCode.toUpperCase();
    const registration = registrations.get(state);
    const registered = registration === undefined
      ? { notRegistered: `no registration was read for ${state}` }
      : "unread" in registration
        ? { notRegistered: registration.unread }
        : registration.bodies.get(walk.attempt.jurisdictionId) ?? {
            notRegistered: `${state} registration and ${registration.reviewedStatus} reviewed registry do not pair ${walk.attempt.jurisdictionId} with one exact governing body`,
          };
    reviews.push(reviewDiscoveryWalk({
      walk,
      routes: walk.routes,
      registered,
      held: (artifactId) => held.get(artifactId) ?? null,
      handWired: (bodyId) => activeWiring().some((wiring) => wiring.bodyId === bodyId),
      reviewer: REVIEWER,
      now,
    }));
  }

  const plan = planDerivedCrosswalk({ previous, reviews });
  for (const id of plan.accepted) console.log(`  accepted ${id}`);
  for (const id of plan.renewed) console.log(`  renewed ${id}`);
  for (const h of plan.held) console.log(`  held ${h.jurisdictionId} ${h.route}${h.bodyName ? ` (${h.bodyName})` : ""}: ${h.reason}: ${h.detail}`);
  const decided = plan.accepted.length + plan.renewed.length;
  console.log(floorLine(floored(
    "meeting bodies accepted or renewed",
    "this run's crosswalk plan",
    decided + plan.held.length,
    decided,
    reviews.length === 0 ? "no discovery walk was held for any registered government" : "the walks reviewed produced no body to accept, renew or hold",
  )));
  await finish(derivedCrosswalkCandidate(plan, [
    ...(lkgInput === null ? [] : [lkgInput]),
    ...[...registrations.values()].flatMap((entry) => "input" in entry ? [entry.input] : []),
  ], now));
}

await main();
