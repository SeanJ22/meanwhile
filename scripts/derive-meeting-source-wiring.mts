/**
 * The meeting-source wiring, recomputed by the standing runner from what is
 * already promoted or vaulted.
 *
 *   node --experimental-strip-types scripts/derive-meeting-source-wiring.mts --promote
 *
 * The standing runner's child for the `meeting-source-wiring` routine contract.
 * It fetches nothing from any publisher. It reads:
 *
 * - the promoted wiring version it succeeds (its rows, suspensions and all);
 * - the promoted meeting-body crosswalk: the reviewed rows connecting a calendar
 *   to its exact body (`lib/civic-data/meeting-body-crosswalk.ts`), composed
 *   with the rows the runner's own reviewer accepted
 *   (`lib/civic-data/derived-crosswalk.ts`), the reviewed rows winning;
 * - each covered state's promoted registration: which division a government is;
 * - the discovery walk's newest attempt for each crosswalked government, from
 *   the control plane's attempt log (read only);
 * - the evidence vault, read only (`lib/control-plane/evidence/read-only-vault.ts`):
 *   the calendar bytes a walk confirmed, and the page naming each body;
 * - the venue resolutions the reader adapters resolve each sitting through, read
 *   before any adapter reading (`lib/control-plane/discovery/derived-wiring-reading.ts`).
 *
 * Each row is decided by `deriveWiringDecisions` (the review triggers, and
 * every outage held as it is), planned by `planDerivedVersion`, and promoted
 * through `processRegisteredRoutineCandidate`, whose door checks every
 * promoted input against the store. Anything it cannot read refuses the
 * candidate by name and leaves the last known good wiring live.
 *
 * Every pass re-checks every calendar, suspended ones included: a suspended
 * row whose calendar passes every check again is restored.
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import {
  DERIVED_CROSSWALK_RECORD_CLASS,
  DERIVED_CROSSWALK_SCOPE,
  composeCrosswalk,
  readDerivedMeetingBodyCrosswalk,
} from "../lib/civic-data/derived-crosswalk.ts";
import { planDerivedVersion, promotedInputRef, type DerivedInputRef, type DerivedVersionEntry } from "../lib/civic-data/derived-authority.ts";
import {
  DERIVED_WIRING_SOURCE_NAMES,
  derivedWiringCandidate,
  derivedWiringEntries,
  derivedWiringFailedCandidate,
  readDerivedMeetingWiring,
  type DerivedWiringKind,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { CURRENT_CALENDAR_READS_SQL, deriveWiringDecisions, latestCalendarWalk, sameRoute, wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import { heldArtifactCaptures, heldManualCrosswalkCapture } from "../lib/civic-data/held-artifact-captures.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import { activeWiring } from "../lib/registry/source-wiring.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";

const CONTRACT_ID = "meeting-source-wiring";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-meeting-source-wiring.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
// A body a hand-wired door already serves gets no derived row; without the doors, that cannot be told, so nothing is derived.
const doors = await ensureMeetingDoors();
if (!doors.ready) throw new Error(`MEETING_DOORS_UNREADABLE: ${doors.reason}`);

async function finish(candidate: RoutineCandidate): Promise<void> {
  // An unchanged wiring re-check is receipted on the pointed version instead of
  // re-promoted; the receipt then names that version, never the unwritten
  // re-check candidate.
  await promoteDerivedCandidate(store, CONTRACT_ID, candidate, now);
}

/* A state, DC or a territory: every registered one has its registration (lib/ocd/state-of.ts). */
const stateOf = (ocdId: string): string | null => ocdStateCode(ocdId)?.toUpperCase() ?? null;
/** The reader adapters' output version. Change it only when an adapter's output changes. */
const ADAPTER_OUTPUT_VERSION = 1;
const adapterDigest = (kind: DerivedWiringKind): string => `${DERIVED_WIRING_SOURCE_NAMES[kind]}@v${ADAPTER_OUTPUT_VERSION}`;

/** A suspension is cleared only for a row whose calendar passes every check again this pass. */
const unsuspended = <Row,>({ suspension: _suspension, ...entry }: DerivedVersionEntry<Row>): DerivedVersionEntry<Row> => entry;

/** The held bytes as text, or why they could not be read: the adapter reading refuses an unreadable body by name. */
async function heldText(held: HeldVaultArtifact): Promise<HeldCalendarReading["held"]> {
  try {
    return { text: new TextDecoder().decode(await readHeldBytes(held)), contentType: held.contentType };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const lkg = await readDerivedMeetingWiring({ store, bypassCache: true, now });
  if (lkg.kind === "STORE_UNREACHABLE") {
    await finish(derivedWiringFailedCandidate(now, `The previous wiring version could not be read (${lkg.code}): ${lkg.detail}`));
    return;
  }
  const previous = lkg.kind === "PROMOTED" ? derivedWiringEntries(lkg.value) : [];
  const lkgInput = lkg.kind === "PROMOTED"
    ? promotedInputRef("CURATED_READER_RECORD", "US:meeting-source-wiring", lkg.metadata.versionId, lkg.value, lkg.metadata.promotedAt)
    : null;

  /*
   * Two crosswalks, composed: the reviewed manual one and the rows the runner's own
   * reviewer accepted (meeting-body-crosswalk-derived). A reviewed row wins over an automatic one for the same body,
   * and either alone connects calendars. An unreadable one refuses the pass; neither promoted is no connection yet.
   */
  const crosswalkContract = requiredManualProductionContract("meeting-body-crosswalk");
  const crosswalk = await readCuratedReaderProjection("meeting-body-crosswalk", { store, bypassCache: true, now });
  const automaticRead = await readDerivedMeetingBodyCrosswalk({ store, bypassCache: true, now });
  for (const read of [crosswalk, automaticRead]) {
    if (read.kind !== "PROMOTED" && read.kind !== "NOT_RECORDED") {
      await finish(derivedWiringFailedCandidate(now, `A meeting-body crosswalk could not be read (${read.kind}): ${"detail" in read ? read.detail : ""}`));
      return;
    }
  }
  if (crosswalk.kind !== "PROMOTED" && automaticRead.kind !== "PROMOTED") {
    await finish(derivedWiringFailedCandidate(now, "No reviewed or automatic meeting-body crosswalk is promoted yet, so no calendar is connected to a body."));
    return;
  }
  const manualInput = crosswalk.kind === "PROMOTED"
    ? promotedInputRef(crosswalkContract.recordClass, crosswalkContract.scope, crosswalk.metadata.versionId, crosswalk.value, crosswalk.metadata.promotedAt)
    : null;
  const automaticInput = automaticRead.kind === "PROMOTED"
    ? promotedInputRef(DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE, automaticRead.metadata.versionId, automaticRead.value, automaticRead.metadata.promotedAt)
    : null;
  if ((crosswalk.kind === "PROMOTED" && manualInput === null) || (automaticRead.kind === "PROMOTED" && automaticInput === null)) {
    await finish(derivedWiringFailedCandidate(now, "A promoted crosswalk carries no version id or promotion time."));
    return;
  }
  const composed = composeCrosswalk(
    crosswalk.kind === "PROMOTED" ? crosswalk.value.records as unknown as MeetingBodyCrosswalkRow[] : null,
    automaticRead.kind === "PROMOTED" ? automaticRead.value.records : null,
  );
  for (const s of composed.shadowed) console.log(`  automatic row ${s.id} not used: ${s.why}`);
  const crosswalkInput = (manualInput ?? automaticInput)!;
  const automatic = automaticInput === null
    ? undefined
    : { input: automaticInput, versionId: automaticRead.metadata.versionId ?? "", rowIds: composed.automaticIds };
  const rows = composed.rows.filter((row) => crosswalkRowIssue(row) === null);

  /* Registration supplies the Census division. The reviewed registry may own its exact governing body. */
  const reviewed = await readRegistryRuntimeProjection({ store, bypassCache: true, now });
  const reviewedInput = reviewed.kind === "PROMOTED"
    ? promotedInputRef("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, reviewed.metadata.versionId, reviewed.value, reviewed.metadata.promotedAt)
    : null;
  const registrations = new Map<string, {
    readonly input: DerivedInputRef;
    readonly bodies: readonly { id: string; ocdId: string; jurisdictionId: string | null }[];
    readonly referenceSha256: string;
  } | { readonly unread: string }>();
  for (const state of new Set(rows.map((row) => stateOf(row.ocdId)).filter((s): s is string => s !== null))) {
    console.log(`RCD_PROGRESS meeting-source-wiring registration ${state}`);
    try {
      const read = await readRegistrationProjection(state, { store, bypassCache: true, now });
      const input = read.kind === "PROMOTED" ? promotedInputRef("REGISTRATION", read.metadata.scope, read.metadata.versionId, read.value, read.metadata.promotedAt) : null;
      if (read.kind !== "PROMOTED" || input === null) {
        registrations.set(state, { unread: `${state} registration is ${read.kind}` });
        continue;
      }
      registrations.set(state, { input,
        bodies: read.value.bodies.map((b) => ({ id: b.id, ocdId: b.ocdId, jurisdictionId: b.jurisdictionId })),
        referenceSha256: read.value.vintage.referenceSha256 });
    } catch (error) {
      registrations.set(state, { unread: `${state} registration could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /* The newest walk of each crosswalked government, read only. */
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) {
    await finish(derivedWiringFailedCandidate(now, "The control plane's attempt log is not configured (WTP_CONTROL_PLANE_DATABASE_URL), so no walk can be read."));
    return;
  }
  const jurisdictions = [...new Set(rows.map((row) => row.jurisdictionId))];
  let attempts: { attempt: MeetingsDiscoveryAttempt; recordId: string; recordedAt: string }[];
  try {
    const sql = neon(controlPlane);
    const found = jurisdictions.length === 0 ? [] : await sql.query(
      CURRENT_CALENDAR_READS_SQL,
      [jurisdictions],
    ) as { id: string; position: number | string; value: MeetingsDiscoveryAttempt }[];
    attempts = found.map((row) => ({ attempt: row.value, recordId: String(row.position), recordedAt: row.value.finishedAt }));
  } catch (error) {
    await finish(derivedWiringFailedCandidate(now, `The discovery-attempt log could not be read: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  /* The vault, read only, and the adapter's reading of every held route byte the walks cite. */
  const vaultRoot = join(process.cwd(), "data", "control-plane", "vault");
  const citedIds = [...new Set([
    ...attempts.flatMap(({ attempt }) => [...attempt.found, ...attempt.steps].flatMap(row => row.artifactId ? [row.artifactId] : [])),
    ...rows.filter(row => row.status === "ACTIVE").map(row => artifactId("RAW", `sha256-${row.evidence.bodyPage.sha256}`)),
  ])];
  const capture = await heldArtifactCaptures(vaultRoot, citedIds, controlPlane);
  const byId = new Map<string, HeldVaultArtifact>();
  const byHash = new Map<string, HeldVaultArtifact>();
  for (const id of citedIds) {
    const held = await capture(id);
    if (held) { byId.set(id, held); byHash.set(held.contentHash.slice("sha256-".length), held); }
    console.log(`RCD_PROGRESS meeting-source-wiring cited capture ${id}`);
  }
  for (const row of rows.filter(row => row.status === "ACTIVE")) {
    const hash = row.evidence.bodyPage.sha256;
    if (!byHash.has(hash) || byHash.get(hash)?.tier === "RESTRICTED_RAW") {
      const held = await heldManualCrosswalkCapture(vaultRoot, hash, row.evidence.readAt);
      if (held) byHash.set(hash, held);
      console.log(`RCD_PROGRESS meeting-source-wiring body-page ${row.id}`);
    }
  }
  const refOf = (held: HeldVaultArtifact | null) =>
    held === null || held.tier === "RESTRICTED_RAW"
      ? null
      : ({ kind: "VAULTED_EVIDENCE" as const, artifactId: held.id, contentHash: held.contentHash, tier: held.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" as const : "RAW" as const, retrievedAt: held.retrievedAt ?? now });
  const pending: HeldCalendarReading[] = [];
  for (const reviewed of rows.filter((row) => row.status === "ACTIVE")) {
    console.log(`RCD_PROGRESS meeting-source-wiring ${reviewed.id}`);
    const walk = latestCalendarWalk(attempts, reviewed.jurisdictionId, reviewed.route)?.attempt;
    if (walk === undefined) continue;
    const others = rows.filter((r) => r.jurisdictionId === reviewed.jurisdictionId && r.bodyId !== reviewed.bodyId && r.status === "ACTIVE").map((r) => r.bodyName);
    const cited = [
      ...walk.found.filter((f) => sameRoute(f.url, reviewed.route)).map((f) => f.artifactId),
      ...walk.steps.filter((s) => sameRoute(s.url, reviewed.route)).map((s) => s.artifactId),
    ].filter((id): id is string => id !== null);
    for (const artifactId of new Set(cited)) {
      const held = await capture(artifactId);
      console.log(`RCD_PROGRESS meeting-source-wiring capture ${artifactId}`);
      const evidence = refOf(held);
      if (held === null || evidence === null) continue;
      pending.push({ key: `${reviewed.id}\u0000${artifactId}`, row: wiringRowFor(reviewed), held: await heldText(held), evidence, others });
    }
  }
  /* The Reader projections the adapters resolve through are read before any reading; an unreadable one refuses the pass. */
  const read = await readHeldCalendars({ options: { store, bypassCache: true, now }, now, adapterDigest, readings: pending });
  if (read.kind === "UNREADABLE") {
    await finish(derivedWiringFailedCandidate(now, read.detail));
    return;
  }
  const readings = read.verifications;

  const decisions = deriveWiringDecisions({
    crosswalk: {
      input: crosswalkInput,
      versionId: (crosswalk.kind === "PROMOTED" ? crosswalk.metadata.versionId : automaticRead.metadata.versionId) ?? "",
      rows,
      ...(automatic === undefined ? {} : { automatic }),
    },
    registration: (row) => {
      const state = stateOf(row.ocdId);
      const reg = state === null ? undefined : registrations.get(state);
      if (reg === undefined || "unread" in reg) return { notRegistered: reg !== undefined && "unread" in reg ? reg.unread : `no covered state in ${row.ocdId}` };
      const body = reg.bodies.find((b) => b.jurisdictionId === row.jurisdictionId);
      if (body !== undefined) {
        if (body.ocdId !== row.ocdId) return { notRegistered: `registration pairs ${row.jurisdictionId} with ${body.ocdId}, not ${row.ocdId}` };
        if (row.bodyRole !== "SUB_BODY" && body.id !== row.bodyId) return { notRegistered: `registration's body is ${body.id}, not ${row.bodyId}` };
        return { input: reg.input };
      }
      if (reviewed.kind !== "PROMOTED" || reviewedInput === null) {
        return { notRegistered: `registration pairs ${row.jurisdictionId} with no body and the reviewed registry is ${reviewed.kind}` };
      }
      let resolved: ReturnType<typeof reviewedBodyForGovernment>;
      try {
        const reference = loadRegistrationReference(process.cwd(), state!);
        if (reference.sha256 !== reg.referenceSha256) {
          return { notRegistered: `${state} registration does not name the committed Census government pairing` };
        }
        resolved = reviewedBodyForGovernment(reference, row.jurisdictionId, reviewed.value.registry.bodies);
      } catch (error) {
        return { notRegistered: `${state} Census government pairing could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
      if (resolved === null || resolved.ocdId !== row.ocdId || (row.bodyRole !== "SUB_BODY" && resolved.bodyId !== row.bodyId)) {
        return { notRegistered: `registration and reviewed registry do not pair ${row.jurisdictionId} with ${row.bodyId}` };
      }
      return { input: reg.input, identityInput: reviewedInput };
    },
    attempts,
    handWired: (bodyId) => activeWiring().some((wiring) => wiring.bodyId === bodyId),
    vaulted: (artifactId) => refOf(byId.get(artifactId) ?? null),
    /* A credential-bearing page is held as its sanitized derivative, filed under the raw page's sha256 (vault-crosswalk-evidence). */
    vaultedBytes: (hex) => refOf(byHash.get(hex) ?? null),
    verify: (row, _binding, evidence) =>
      readings.get(`${row.crosswalkRowId}\u0000${evidence.artifactId}`) ?? { refused: `no adapter reading of ${evidence.artifactId} was made this pass` },
    adapterDigest,
    previous: previous.map(unsuspended),
    now,
  });
  const restored = new Set(decisions.filter((d) => d.disposition === "PROMOTE").map((d) => d.key));
  const plan = planDerivedVersion(previous.map((entry) => restored.has(entry.key) ? unsuspended(entry) : entry), decisions);
  for (const d of decisions) {
    console.log(`  ${d.key}: ${d.disposition === "HOLD" ? `HOLD ${d.reason}: ${d.detail}` : d.disposition === "SUSPEND" ? `SUSPEND ${d.trigger}: ${d.detail}` : d.disposition}`);
  }
  for (const r of plan.refusals) console.error(`  refused ${r.key}: ${r.code}: ${r.detail}`);
  console.log(floorLine(floored(
    "derived wiring rows promoted",
    "the calendar-to-body rows decided this pass",
    decisions.length,
    decisions.filter((d) => d.disposition === "PROMOTE").length,
    decisions.length === 0 ? "no calendar-to-body row reached the derive this pass" : undefined,
  )));
  await finish(derivedWiringCandidate(plan, [...new Set([manualInput, automaticInput, lkgInput])].filter((i): i is DerivedInputRef => i !== null), now));
}

await main();
