import { join } from "node:path";

import { neon } from "../lib/db/client.ts";

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
import { deriveWiringDecisions, latestCalendarWalk, sameRoute, wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { reviewedBodyForGovernment } from "../lib/control-plane/discovery/reviewed-body.ts";
import { readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import { heldArtifactCaptures, heldManualCrosswalkCapture } from "../lib/civic-data/held-artifact-captures.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { ocdStateCode } from "../lib/ocd/state-of.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { activeWiring } from "../lib/registry/source-wiring.ts";
import { ensureMeetingDoors } from "../lib/doors/meeting-doors.ts";
import { confirmMeetingDerivationSource, meetingDerivationCanContinue, meetingDerivationConfig, meetingDerivationPending, readMeetingDerivationSource, readMeetingDerivationWalks, withMeetingDerivationProbe } from "../lib/civic-data/meeting-derivation-source.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const CONTRACT_ID = "meeting-source-wiring";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-meeting-source-wiring.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();

async function finish(candidate: RoutineCandidate): Promise<void> {
  await promoteDerivedCandidate(store, CONTRACT_ID, candidate, now, { confirmUnchanged: false });
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
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) {
    await finish(derivedWiringFailedCandidate(now, "The control plane's attempt log is not configured (WTP_CONTROL_PLANE_DATABASE_URL), so no walk can be read."));
    return;
  }
  const sql = neon(controlPlane), query = async (text: string, params: readonly unknown[] = []) => sql.query(text, [...params]);
  const crosswalkContract = requiredManualProductionContract("meeting-body-crosswalk");
  const venues = requiredManualProductionContract("venue-resolutions");
  const sourceOptions = { store, query, sourceId: CONTRACT_ID, recordClass: DERIVED_WIRING_RECORD_CLASS, scope: DERIVED_WIRING_SCOPE,
    reuseGroups: true, pointers: [{ recordClass: crosswalkContract.recordClass, scope: crosswalkContract.scope },
      { recordClass: DERIVED_CROSSWALK_RECORD_CLASS, scope: DERIVED_CROSSWALK_SCOPE }, { recordClass: venues.recordClass, scope: venues.scope }],
    configHash: meetingDerivationConfig(process.cwd(), ["data/derived/registration/index.json", "lib/control-plane/discovery/derived-wiring.ts",
      "lib/control-plane/discovery/derived-wiring-reading.ts", "lib/control-plane/discovery/reviewed-body.ts",
      "lib/civic-data/derived-meeting-wiring.ts"], [ADAPTER_OUTPUT_VERSION, now.slice(0, 10)]) };
  let source: Awaited<ReturnType<typeof readMeetingDerivationSource>>;
  try {
    source = await readMeetingDerivationSource(sourceOptions);
    const confirmed = await confirmMeetingDerivationSource({ source, store, sourceId: CONTRACT_ID,
      recordClass: DERIVED_WIRING_RECORD_CLASS, scope: DERIVED_WIRING_SCOPE, parserVersion: "meeting-source-wiring/1", now,
      force: process.argv.includes("--force") });
    if (confirmed) {
      console.log("RCD_RECEIPT=" + JSON.stringify({ source: CONTRACT_ID,
        ...sourceHashReceiptFields(confirmed), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
      return;
    }
  } catch (error) {
    await finish(derivedWiringFailedCandidate(now, `The derivation source metadata could not be read: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }
  const doors = await ensureMeetingDoors();
  if (!doors.ready) throw new Error(`MEETING_DOORS_UNREADABLE: ${doors.reason}`);
  const lkg = await readDerivedMeetingWiring({ store,  now });
  if (lkg.kind === "STORE_UNREACHABLE") {
    await finish(derivedWiringFailedCandidate(now, `The previous wiring version could not be read (${lkg.code}): ${lkg.detail}`));
    return;
  }
  const previous = lkg.kind === "PROMOTED" ? derivedWiringEntries(lkg.value) : [];
  const lkgInput = lkg.kind === "PROMOTED"
    ? promotedInputRef("CURATED_READER_RECORD", "US:meeting-source-wiring", lkg.metadata.versionId, lkg.value, lkg.metadata.promotedAt)
    : null;


  const crosswalk = await readCuratedReaderProjection("meeting-body-crosswalk", { store,  now });
  const automaticRead = await readDerivedMeetingBodyCrosswalk({ store,  now });
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
  const allRows = composed.rows.filter((row) => crosswalkRowIssue(row) === null);
  const groups = Object.fromEntries([...previous.map(entry => entry.row), ...allRows].flatMap(row => {
    const state = stateOf(row.ocdId); return state ? [[row.jurisdictionId, state]] : [];
  }));
  source = await readMeetingDerivationSource({ ...sourceOptions, groups });
  const remaining = new Set(meetingDerivationPending(source, process.argv.includes("--force")));
  const completed = { ...source.priorProbe?.groups };
  const previousHeld = source.outputHead ? await store.readCandidatePath<NonNullable<RoutineCandidate["excludedFacts"]>>(
    source.outputHead.versionId, ["excludedFacts"]) ?? [] : [];


  /* Registration supplies the Census division. The reviewed registry may own its exact governing body. */
  const reviewedBodies = new Map<string, { readonly resolved: NonNullable<ReturnType<typeof reviewedBodyForGovernment>>; readonly input: DerivedInputRef } | { readonly unread: string }>();
  const registrations = new Map<string, {
    readonly input: DerivedInputRef;
    readonly bodies: readonly { id: string; ocdId: string; jurisdictionId: string | null }[];
  } | { readonly unread: string }>();
  const loadRegistration = async (state: string): Promise<void> => {
    if (registrations.has(state)) return;
    console.log(`RCD_PROGRESS meeting-source-wiring registration ${state}`);
    try {
      const reference = loadRegistrationReference(process.cwd(), state);
      const selected=allRows.filter(row=>stateOf(row.ocdId)===state && remaining.has(row.jurisdictionId));
      const wanted=[...new Set(selected.map(row=>row.jurisdictionId))],ids=new Set(wanted);
      const lookup=await store.readGovernmentLookup(state,wanted,reference.reference.governments.filter(row=>ids.has(row[1])).map(row=>row[0]),selected.map(row=>row.bodyId));
      const read=lookup.registration,reviewed=lookup.reviewed;
      if(!read){registrations.set(state,{unread:`${state} registration is NOT_RECORDED`});return;}
      const input=read.input;
      registrations.set(state,{input,bodies:read.value.bodies.map(body=>({id:body.id,ocdId:body.ocdId,jurisdictionId:body.jurisdictionId}))});
      for(const row of selected){
        if(!reviewed)reviewedBodies.set(row.id,{unread:`${state} reviewed registry is NOT_RECORDED`});
        else if(reference.sha256!==read.value.vintage.referenceSha256)reviewedBodies.set(row.id,{unread:`${state} registration does not name the committed Census government pairing`});
        else{
          const resolved=reviewedBodyForGovernment(reference,row.jurisdictionId,reviewed.bodies);
          reviewedBodies.set(row.id,resolved?{resolved,input:reviewed.input}:{unread:`${state} reviewed registry does not pair ${row.jurisdictionId} with one exact governing body`});
        }
      }
    } catch (error) {
      registrations.set(state, { unread: `${state} registration could not be read: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const decisions: ReturnType<typeof deriveWiringDecisions>[number][] = [];
  for (const jurisdiction of remaining) {
    if (!meetingDerivationCanContinue()) break;
    const rows = allRows.filter(row => row.jurisdictionId === jurisdiction);
    const groupPrevious = previous.filter(entry => entry.row.jurisdictionId === jurisdiction);
    const state = groups[jurisdiction];
    if (state) await loadRegistration(state);
    const attempts = await readMeetingDerivationWalks(query, source.walks.filter(walk => walk.jurisdiction === jurisdiction));

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
    const read = await readHeldCalendars({ options: { store,  now }, now, adapterDigest, readings: pending });
    if (read.kind === "UNREADABLE") {
      console.error(`RCD_PROGRESS meeting-source-wiring pending ${jurisdiction}: ${read.detail}`);
      continue;
    }
    const readings = read.verifications;

    const groupDecisions = deriveWiringDecisions({
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
        const reviewed = reviewedBodies.get(row.id);
        if (!reviewed || "unread" in reviewed) return { notRegistered: reviewed?.unread ?? `${state} reviewed registry was not read` };
        const { resolved } = reviewed;
        if (resolved === null || resolved.ocdId !== row.ocdId || (row.bodyRole !== "SUB_BODY" && resolved.bodyId !== row.bodyId)) {
          return { notRegistered: `registration and reviewed registry do not pair ${row.jurisdictionId} with ${row.bodyId}` };
        }
        return { input: reg.input, identityInput: reviewed.input };
      },
      attempts,
      handWired: (bodyId) => activeWiring().some((wiring) => wiring.bodyId === bodyId),
      vaulted: (artifactId) => refOf(byId.get(artifactId) ?? null),
      /* A credential-bearing page is held as its sanitized derivative, filed under the raw page's sha256 (vault-crosswalk-evidence). */
      vaultedBytes: (hex) => refOf(byHash.get(hex) ?? null),
      verify: (row, _binding, evidence) =>
        readings.get(`${row.crosswalkRowId}\u0000${evidence.artifactId}`) ?? { refused: `no adapter reading of ${evidence.artifactId} was made this pass` },
      adapterDigest,
      previous: groupPrevious.map(unsuspended),
      now,
    });
    decisions.push(...groupDecisions);
    if (!groupDecisions.some(decision => decision.disposition === "HOLD" &&
      ["BODY_NOT_REGISTERED", "EVIDENCE_NOT_VAULTED", "ADAPTER_REFUSED"].includes(decision.reason))) {
      completed[jurisdiction] = source.groupHashes[jurisdiction]!;
      remaining.delete(jurisdiction);
    }
  }
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
  const candidate = derivedWiringCandidate(plan, [...new Set([manualInput, automaticInput, lkgInput])].filter((i): i is DerivedInputRef => i !== null), now);
  const touched = new Set(decisions.map(decision => `derived-wiring:${decision.key}`));
  await finish(withMeetingDerivationProbe({ ...candidate, excludedFacts: [
    ...previousHeld.filter(fact => !fact.key || !touched.has(fact.key)), ...(candidate.excludedFacts ?? []),
  ] }, source, completed, [...remaining]));
}

await main();
