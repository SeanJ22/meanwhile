import { resolve } from "node:path";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import type { Query } from "../facts/publish.ts";
import { publishStateFacts, type StateFactsPointer, type StateFactsPublication } from "../facts/state-facts-publication.ts";
import { hasMeetingPartitions, meetingStateOfScope, planMeetingBodies, type MeetingBodyPlan } from "../meetings/body-publication.ts";
import {
  authorityPlaceOfScope,
  authorityPointerKey,
  publishReaderMeetings,
  ensureReaderAuthorityEdge,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  readServedFactBucket,
  readServedPointer,
  stateFactsPointerKey,
  writeAuthorityPointer,
  writeFactBucket,
  writeFactRecord,
  type AuthorityPointerFamily,
  type PublishAuthorityValue,
} from "../meetings/edge-serving.ts";
import { isStateAuthorityFamily, PROMOTED_AUTHORITY_FAMILIES, type GlobalPromotedAuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { withReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStateAuthorityProjection } from "./state-reader.ts";
import { readCensusGeographyProjection } from "../census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { STATE_PEOPLE_JURISDICTIONS, statePeopleSourcePointers } from "../officials/people-identity.ts";
import { statePeopleVersion } from "../officials/people-version.ts";
import { combinedOutcomeVersionId, combineOutcomeProjections, doorOutcomeParts, doorOutcomesUnreadable, outcomePointers, readDoorOutcomeProjections } from "../outcomes/store.ts";
import { DOOR_OUTCOME_POINTERS } from "../outcomes/door-outcome-pointers.ts";
import { outcomePartitionsAreCurrent } from "./outcome-partitions.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "../outcomes/data-plane.ts";
import type { RoutineDataStore } from "./store.ts";
import { promotedEdgePieces, publishPromotedEdgeFamily, selectedStateEdgePointers } from "./promoted-edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeByState } from "../census-geography/district-edge.ts";
import { postalArea } from "../geo/postal.ts";
import { childEnvironment, dispatchStateArtifacts, type StateArtifactChildren } from "./state-artifact-dispatch.ts";
import { readReaderEdgeChanges } from "./reader-edge-changes.ts";
import { runBoundedChildPass } from "./bounded-child-pass.ts";
import { admittedRuntimeChildEnvironment } from "./runtime-authority.ts";
import { routineProcessSlots, type WorkerMemoryRelease } from "../control-plane/workers/worker-slots.ts";
import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

function safeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "Reader repair failed without a diagnostic.";
}

export type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

/** One family of one place (or of the nation), or one state's meetings: the unit the edge publishes, saves and resumes by. */
export interface ReaderEdgePiece { readonly family: string; readonly place: string | null }
export const readerEdgePieceKey = (piece: ReaderEdgePiece) => piece.place === null ? piece.family : `${piece.family}/${piece.place}`;

type Pointer = Pick<PromotedPointerIdentity, "recordClass" | "scope">;
const manual = (id: string) => MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === id)!;
const CENSUS_POINTER: Pointer = { recordClass: CENSUS_GEO_RECORD_CLASS, scope: CENSUS_GEO_SCOPE };
const outcomeSources = (): readonly Pointer[] => [PIMA_LEGISTAR_OUTCOMES_CONTRACT, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, ...DOOR_OUTCOME_POINTERS];
const storeName = (store: ReaderArtifactStore | null): ReaderEdgePublicationOutcome["store"] =>
  store?.kind === "local-file" ? "local folder" : store?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured";

/** The pieces these pointers move: each meeting state first (after its registry, which draws its territories) so readers see meetings soonest. */
export function readerEdgePieces(changed: readonly Pointer[]): ReaderEdgePiece[] {
  const ballotStates = new Set(selectedStateEdgePointers(changed).filter(unit => unit.family === "ballot-contests").map(unit => unit.state));
  // A ballot change delivers the place's ballot and registry families together; its members of Congress move only with their own records.
  const selected = [...changed, ...selectedStateEdgePointers(null)
    .filter(unit => ballotStates.has(unit.state) && unit.family !== "federal-directory").flatMap(unit => unit.pointers)];
  const keys = new Set(selected.map(pointer => `${pointer.recordClass}:${pointer.scope}`));
  const owns = (pointer: Pointer) => keys.has(`${pointer.recordClass}:${pointer.scope}`);
  const pieces = new Map<string, ReaderEdgePiece>();
  const add = (family: string, place: string | null = null) => pieces.set(readerEdgePieceKey({ family, place }), { family, place });
  const units = selectedStateEdgePointers(selected), registries = new Set<string>(units.filter(unit => unit.family === "registry-runtime").map(unit => unit.state));
  const meetingStates = new Set([...[...registries].filter(hasMeetingPartitions), ...selected.map(pointer => pointer.recordClass === "MEETING" ? meetingStateOfScope(pointer.scope) : null)
    .filter((state): state is string => state !== null)]);
  for (const state of [...meetingStates].sort()) {
    if (registries.has(state)) add("registry-runtime", state);
    add("meetings", state);
  }
  for (const unit of units) add(unit.family, unit.state);
  if (owns(manual("everyday-routing"))) add("everyday-routing");
  if (owns(CENSUS_POINTER)) add("census-districts");
  if (owns(manual("campaign-sites"))) add("campaign-sites");
  for (const pointer of outcomeSources()) if (owns(pointer)) add("meeting-outcomes", authorityPlaceOfScope(pointer.scope));
  for (const piece of promotedEdgePieces(selected)) add(piece.family, piece.place);
  for (const { scope, state } of REGISTRATION_TARGETS) if (owns({ recordClass: "REGISTRATION", scope })) add("registrations", state.toLowerCase());
  for (const jurisdiction of STATE_PEOPLE_JURISDICTIONS) if (statePeopleSourcePointers(jurisdiction).some(owns)) add("state-legislators", jurisdiction);
  return [...pieces.values()];
}

/** Publishes one piece that is not a state authority family; a state family's artifact is built by its own child (state-artifact-dispatch.ts). */
export async function publishReaderEdgePiece(store: RoutineDataStore, observedAt: string, piece: ReaderEdgePiece,
  artifactStore: ReaderArtifactStore): Promise<ReaderEdgePublicationOutcome> {
  const { family, place } = piece;
  const published: string[] = [], skipped: string[] = [];
  let sequence: number | null = null, supersededMeetingFields: number | undefined, status = "CURRENT", detail: string | null = null;
  const skip = (line: string) => { skipped.push(line); process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`); };
  const pointerVersion = (recordClass: RoutineRecordClass, scope: string) => async () =>
    (await store.readPromotionIdentity(recordClass, scope))?.versionId ?? null;
  /** The family's pointer is skipped when it already names the current version, and written at once when it moved. */
  const publishFamily = async (name: AuthorityPointerFamily, currentVersion: () => Promise<string | null>,
    read: () => Promise<PublishAuthorityValue | null>, at?: string) => {
    const label = at === undefined ? name : `${name}/${at}`;
    try {
      const served = await readServedPointer(artifactStore, authorityPointerKey(name, at));
      if (served?.ref.layout === "records" && served.ref.version === await currentVersion().catch(() => null)) return;
      const entry = await read();
      if (!entry) return;
      if (await writeAuthorityPointer(artifactStore, name, at, entry, served, observedAt)) published.push(label);
      else skip(`${label} READER_POINTER_RACED`);
    } catch (error) { skip(`${label} ${sanitizedErrorDiagnostic(error)}`); }
  };
  try {
    if (family === "everyday-routing") {
      const routing = manual("everyday-routing");
      const versionId = async () => (await store.readPromotionIdentity(routing.recordClass, routing.scope))?.versionId ?? "not-recorded";
      await publishFamily("everyday-routing", versionId, async () => {
        const read = await readEverydayRoutingProjection({ store, now: observedAt, bypassCache: true });
        if (read.kind !== "PROMOTED" && read.kind !== "NOT_RECORDED") throw new Error("everyday routing read " + read.kind);
        return { value: { projection: read.kind === "PROMOTED" ? read.value : null }, versionId: await versionId() };
      });
    } else if (family === "census-districts") {
      // One national promotion, written as each state's own shard and only where that shard's content changed.
      const census = await readCensusGeographyProjection({ store, now: observedAt });
      if (census.kind === "PROMOTED" && census.metadata.versionId) {
        const shards = censusDistrictEdgeByState(buildCensusDistrictEdge(census.value, census.metadata.versionId), zip => postalArea(zip)?.state ?? "US");
        for (const [state, shard] of shards) await publishFamily("census-districts", async () => shard.versionId, async () => ({ value: shard, versionId: shard.versionId }), state);
      } else if (census.kind !== "NOT_RECORDED") skip(`census-districts read ${census.kind}`);
    } else if (family === "campaign-sites") {
      const sites = manual("campaign-sites");
      await publishFamily("campaign-sites", pointerVersion(sites.recordClass, sites.scope), async () => {
        const read = await readCuratedReaderProjection("campaign-sites", { store, now: observedAt, bypassCache: true });
        if (read.kind === "PROMOTED" && read.metadata.versionId) return { value: read.value, versionId: read.metadata.versionId };
        if (read.kind !== "NOT_RECORDED") throw new Error(`campaign-sites read ${read.kind}`);
        return null;
      });
    } else if (family === "meeting-outcomes") {
      // The doors were not read this pass, so the door list is unknown, not empty: the served artifact stands
      // rather than one that silently drops every door's outcomes.
      const doors = outcomePointers().filter(door => authorityPlaceOfScope(door.scope) === place);
      if (outcomePartitionsAreCurrent() && doors.length) await publishFamily("meeting-outcomes", async () =>
        combinedOutcomeVersionId((await Promise.all(doors.map(async door => ({ contractId: door.contractId,
          versionId: await pointerVersion(door.recordClass, door.scope)() })))).filter((door): door is { contractId: string; versionId: string } => door.versionId !== null)),
      async () => {
        // Complete or left out: a failed read must not publish the rest alone as if it had nothing.
        await readDoorOutcomeProjections({ store, now: observedAt, bypassCache: true });
        const unreadable = doorOutcomesUnreadable().filter(contractId => doors.some(door => door.contractId === contractId));
        if (unreadable.length > 0) throw new Error(`door outcomes read failed for ${unreadable.join(", ")}`);
        return combineOutcomeProjections(doorOutcomeParts().filter(part => doors.includes(part.pointer))
          .map(part => ({ value: part.value, pointers: [{ contractId: part.pointer.contractId, tenant: part.pointer.slug, versionId: part.versionId }] })));
      }, place!);
    } else if (family === "registrations") {
      const target = REGISTRATION_TARGETS.find(row => row.state.toLowerCase() === place);
      if (!target) throw new Error(`READER_EDGE_PIECE_UNKNOWN:${family}/${place}`);
      const versionId = (await store.readPromotionIdentity("REGISTRATION", target.scope))?.versionId ?? "none";
      await publishFamily("registrations", async () => versionId, async () => {
        if (versionId === "none") return { value: null, versionId };
        const read = await readRegistrationProjection(place!, { store, now: observedAt, bypassCache: true });
        if (read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) throw new Error(`registration ${target.state} read ${read.kind} at a different version`);
        return { value: read.value, versionId };
      }, place!);
    } else if (family === "state-legislators") {
      const jurisdiction = STATE_PEOPLE_JURISDICTIONS.find(row => row === place);
      if (!jurisdiction) throw new Error(`READER_EDGE_PIECE_UNKNOWN:${family}/${place}`);
      const sourcePointers = statePeopleSourcePointers(jurisdiction);
      const versionId = async () => {
        const pointers = (await Promise.all([...new Set(sourcePointers.map(pointer => pointer.recordClass))].map(recordClass =>
          store.readPromotionIdentities(recordClass, sourcePointers.filter(pointer => pointer.recordClass === recordClass).map(pointer => pointer.scope))))).flat();
        return pointers.length ? statePeopleVersion(jurisdiction, pointers.map(pointer => ({ scope: pointer.scope, versionId: pointer.versionId }))) : "none";
      };
      await publishFamily("state-legislators", versionId, async () => {
        const expected = await versionId();
        if (expected === "none") return { value: null, versionId: expected };
        const read = await readStatePeopleProjection(jurisdiction, { store, now: observedAt, bypassCache: true });
        if (read.kind === "NOT_RECORDED") return { value: null, versionId: "none" };
        if (read.kind !== "PROMOTED" || !read.metadata.versionId) throw new Error(`state people ${jurisdiction} read ${read.kind}`);
        if (read.metadata.versionId !== expected) throw new Error(`state people ${jurisdiction} did not read every accepted source version`);
        return { value: read.value, versionId: expected };
      }, jurisdiction);
    } else if (family === "meetings") {
      const served = (await artifactStore.readManifest())?.manifest ?? null;
      sequence = served?.sequence ?? null;
      const registryRef = (await readServedPointer(artifactStore, authorityPointerKey("registry-runtime", place!)))?.ref;
      let meetingPlan: MeetingBodyPlan | null = null;
      try {
        meetingPlan = await planMeetingBodies({
          store, artifacts: artifactStore, now: observedAt, served: served?.meetingStates, state: place!,
          registryVersion: state => state === place ? registryRef?.version ?? null : null,
          registry: async state => {
            if (state !== place || registryRef === undefined) return null;
            const edge = await ensureReaderAuthorityEdge(null, artifactStore, ["registry-runtime"]);
            const read = await withReaderAuthorityEdge({ ...edge!, edgeOnly: true }, () => readStateAuthorityProjection<RegistryRuntimeReadModel>("registry-runtime", state));
            if (read.result.kind === "NOT_RECORDED") return null;
            if (read.result.kind !== "PROMOTED") throw new Error(`Meeting territories for ${state} read ${read.result.kind}`);
            return { bodies: read.result.value.registry.bodies };
          },
        });
        if (meetingPlan.stats.failed.length > 0) {
          skipped.push(`meetings/${place}`);
          detail = safeFailure(`Meetings of ${meetingPlan.stats.failed.length} bodies could not be composed: ${meetingPlan.stats.failed[0]!.error}`);
          process.stderr.write(`READER_EDGE_MEETING_BODIES_FAILED: ${JSON.stringify(meetingPlan.stats.failed.slice(0, 20))}\n`);
        }
      } catch (error) {
        skipped.push(`meetings/${place}`);
        detail = safeFailure(sanitizedErrorDiagnostic(error));
        process.stderr.write(`READER_EDGE_MEETINGS_CARRIED: ${detail}\n`);
      }
      const edge = await publishReaderMeetings({ store: artifactStore, now: observedAt, ...(meetingPlan ? { meetingStates: meetingPlan.entries } : {}) });
      if (meetingPlan && (edge.status === "PUBLISHED" || edge.status === "CURRENT")) {
        supersededMeetingFields = meetingPlan.stats.superseded;
        await meetingPlan.settle();
        console.log(JSON.stringify({ readerEdgeMeetingBodies: meetingPlan.stats }));
      }
      if ("sequence" in edge) sequence = edge.sequence;
      if (edge.status === "FAILED") throw new Error(edge.error);
      if (edge.status === "RACED") throw new Error("A concurrent reader publication moved the manifest; retry remains owed.");
      if (edge.status === "PUBLISHED") published.push(`meetings/${place}`);
      const purge = edge.status === "PUBLISHED" && artifactStore.kind === "netlify-blobs" ? await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]) : null;
      if (purge) console.log(JSON.stringify({ readerEdgePurge: purge.purged, store: storeName(artifactStore), sequence }));
    } else if ((PROMOTED_AUTHORITY_FAMILIES as readonly string[]).includes(family)) {
      const promoted = await publishPromotedEdgeFamily({ store, artifactStore, now: observedAt, family: family as GlobalPromotedAuthorityFamily, place });
      published.push(...promoted.published);
      promoted.skipped.forEach(skip);
    } else throw new Error(`READER_EDGE_PIECE_UNKNOWN:${readerEdgePieceKey(piece)}`);
    if (published.length) status = "PUBLISHED";
  } catch (error) {
    skipped.push(readerEdgePieceKey(piece));
    detail = safeFailure(sanitizedErrorDiagnostic(error));
    process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${detail}\n`);
  }
  if (published.length) console.log(JSON.stringify({ readerEdgePointers: { published: published.length, sample: published.slice(0, 20) } }));
  const failed = skipped.length > 0;
  return { ok: !failed, readerEdge: failed ? "FAILED" : status, store: storeName(artifactStore), sequence,
    ...(supersededMeetingFields !== undefined ? { supersededMeetingFields } : {}),
    detail: failed ? detail ?? safeFailure(skipped.join(" | ")) : null };
}

const PIECE_RESULT = "READER_EDGE_PIECE=";
const PIECE_SCRIPT = "publish-reader-edge-piece.mts";
// The largest production piece holds 300 MiB live; the bound makes collection keep its footprint near that.
const PIECE_HEAP_MIB = 1024;
const slots = routineProcessSlots();

export function readerEdgePieceResultLine(outcome: ReaderEdgePublicationOutcome): string {
  return PIECE_RESULT + JSON.stringify(outcome);
}

/** A piece runs in a child of its own, so everything it read is released before the next starts. */
async function publishPieceInChild(piece: ReaderEdgePiece, now: string, deadlineMs: number, destination: ReaderEdgePublicationOutcome["store"],
  env: Readonly<Record<string, string | undefined>>, children: StateArtifactChildren): Promise<ReaderEdgePublicationOutcome> {
  const cwd = env.WTP_RUNTIME_AUTHORITY_REPO ?? process.cwd(), childEnv = childEnvironment(env);
  const failed = (detail: string): ReaderEdgePublicationOutcome => ({ ok: false, readerEdge: "FAILED", store: destination, sequence: null, detail: safeFailure(detail) });
  let release: WorkerMemoryRelease | undefined, outcome: ReaderEdgePublicationOutcome | null = null;
  try {
    await runBoundedChildPass([{ id: `reader-edge:${readerEdgePieceKey(piece)}`, executable: process.execPath,
      args: ["--experimental-strip-types", `--max-old-space-size=${PIECE_HEAP_MIB}`, resolve(cwd, "scripts", PIECE_SCRIPT), `--family=${piece.family}`,
        ...(piece.place === null ? [] : [`--place=${piece.place}`]), `--observed-at=${now}`],
      env: admittedRuntimeChildEnvironment({ parentEnv: childEnv, capability: "ROUTINE_SUPERVISOR", parentPid: process.pid }) }], {
      cwd, env: childEnv, deadlineMs, maxBufferBytes: 1024 * 1024, discardOutputAfterSettlement: true,
      onStarting: async command => {
        release = await (children.slots ?? slots).acquire(`${command.id}/${PIECE_SCRIPT}`, deadlineMs);
        (command as { onStarted?: (pid: number) => void }).onStarted = pid => release?.observe?.(pid);
      },
      onSettled: run => {
        const lines = run.stdout.split(/\r?\n/);
        for (const line of lines) if (line && !line.startsWith(PIECE_RESULT)) console.log(line);
        if (run.stderr) process.stderr.write(run.stderr.endsWith("\n") ? run.stderr : `${run.stderr}\n`);
        const results = lines.filter(line => line.startsWith(PIECE_RESULT));
        outcome = run.status === 0 && run.termination === "EXITED" && results.length === 1
          ? JSON.parse(results[0]!.slice(PIECE_RESULT.length)) as ReaderEdgePublicationOutcome
          : failed(`${readerEdgePieceKey(piece)} ${run.errorMessage ?? (run.stderr.trim() || `READER_EDGE_PIECE_CHILD_FAILED ${run.termination}`)}`);
      },
    }, children.launch);
  } catch (error) { outcome = failed(`${readerEdgePieceKey(piece)} ${sanitizedErrorDiagnostic(error)}`); }
  finally { release?.(); }
  return outcome ?? failed(`${readerEdgePieceKey(piece)} READER_EDGE_PIECE_RESULT_MISSING`);
}

async function publishStatePiece(store: RoutineDataStore, artifactStore: ReaderArtifactStore, piece: ReaderEdgePiece, now: string,
  env: Readonly<Record<string, string | undefined>>, children: StateArtifactChildren): Promise<ReaderEdgePublicationOutcome> {
  const units = selectedStateEdgePointers(null).filter(unit => unit.family === piece.family && unit.state === piece.place);
  const states = await dispatchStateArtifacts({ store, currentStore: store, artifactStore, now, selected: units, env, children });
  for (const line of states.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`);
  return { ok: states.skipped.length === 0, readerEdge: states.skipped.length ? "FAILED" : states.published.length ? "PUBLISHED" : "CURRENT",
    store: storeName(artifactStore), sequence: null, detail: states.skipped.length ? safeFailure(states.skipped.join(" | ")) : null };
}

function refusal(artifactStore: ReaderArtifactStore | null, env: Readonly<Record<string, string | undefined>>): ReaderEdgePublicationOutcome | null {
  const store = storeName(artifactStore);
  if (artifactStore === null) return { ok: false, readerEdge: "SKIPPED_NO_STORE", store, sequence: null,
    detail: "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy." };
  return env.WTP_READER_EDGE_LOCAL_OK !== "1" && artifactStore.kind === "local-file" ? { ok: false, readerEdge: "FAILED", store, sequence: null,
    detail: "Reader pages would be saved to a folder on the runner. Readers are still seeing the older copy." } : null;
}

/** Publishes pieces in order, one at a time, telling `published` of each as it lands; pieces past the deadline stay owed. */
export async function publishReaderEdgePieces(input: {
  readonly store: RoutineDataStore;
  readonly artifactStore: ReaderArtifactStore | null;
  readonly pieces: readonly ReaderEdgePiece[];
  readonly deadlineMs: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly children?: StateArtifactChildren;
  readonly published?: (piece: string) => Promise<void>;
  readonly clock?: () => string;
}): Promise<{ readonly outcome: ReaderEdgePublicationOutcome; readonly complete: boolean }> {
  const env = input.env ?? process.env, artifactStore = input.artifactStore, destination = storeName(artifactStore);
  const refused = refusal(artifactStore, env);
  if (refused !== null || artifactStore === null) { console.log(JSON.stringify(refused)); return { complete: false, outcome: refused! }; }
  const published: string[] = [], failures: string[] = [];
  let sequence: number | null = null, supersededMeetingFields: number | undefined, left = 0;
  for (const piece of input.pieces) {
    if (Date.now() >= input.deadlineMs) { left++; continue; }
    const now = input.clock?.() ?? new Date().toISOString(), key = readerEdgePieceKey(piece);
    const outcome = isStateAuthorityFamily(piece.family)
      ? await publishStatePiece(input.store, artifactStore, piece, now, env, input.children ?? {})
      : await publishPieceInChild(piece, now, input.deadlineMs, destination, env, input.children ?? {});
    sequence = outcome.sequence ?? sequence;
    if (outcome.supersededMeetingFields !== undefined) supersededMeetingFields = (supersededMeetingFields ?? 0) + outcome.supersededMeetingFields;
    if (!outcome.ok) { failures.push(`${key}: ${outcome.detail ?? "not published"}`); continue; }
    if (outcome.readerEdge === "PUBLISHED") published.push(key);
    await input.published?.(key);
  }
  console.log(JSON.stringify({ readerEdgePieces: { owed: input.pieces.length, published: published.length, failed: failures.length, left, sample: published.slice(0, 20) } }));
  const outcome: ReaderEdgePublicationOutcome = { ok: failures.length === 0,
    readerEdge: failures.length ? "FAILED" : published.length ? "PUBLISHED" : left ? "RESUMES" : "CURRENT", store: destination, sequence,
    ...(supersededMeetingFields !== undefined ? { supersededMeetingFields } : {}),
    detail: failures.length ? safeFailure(`${failures.length} of ${input.pieces.length} reader pieces were not published; the rest are live. ${failures[0]}`)
      : left ? `${left} of ${input.pieces.length} reader pieces wait for the next pass.` : null };
  console.log(JSON.stringify(outcome));
  return { outcome, complete: failures.length === 0 && left === 0 };
}

/** Publishes what moved since the edge last published; each piece is saved as it lands, and the cursor moves once every piece took the change. */
export async function publishReaderEdge(input: Omit<Parameters<typeof publishReaderEdgePieces>[0], "pieces" | "published"> & { readonly query: Query }): Promise<ReaderEdgePublicationOutcome> {
  const refused = refusal(input.artifactStore, input.env ?? process.env);
  if (refused !== null) { console.log(JSON.stringify(refused)); return refused; }
  const changes = await readReaderEdgeChanges(input.query);
  const pieces = readerEdgePieces(changes.pointers).filter(piece => !changes.done.has(readerEdgePieceKey(piece)));
  const { outcome, complete } = await publishReaderEdgePieces({ ...input, pieces, published: changes.saveDone });
  if (complete) await changes.save();
  return outcome;
}

/** Each state's facts at its own pointer on the reader edge, apart from the manifest. */
export function publishReaderStateFacts(query: Query, artifactStore: ReaderArtifactStore, observedAt: string): Promise<StateFactsPublication> {
  return publishStateFacts(query, {
    readPointer: state => artifactStore.readJsonPointer<StateFactsPointer>(stateFactsPointerKey(state)),
    writePointer: async (state, value, etag) => (await artifactStore.writeJsonPointer(stateFactsPointerKey(state), value, etag)).modified,
    readBucket: (state, bucket, ref) => readServedFactBucket(state, bucket, ref, artifactStore),
    writeRecord: value => writeFactRecord(artifactStore, value),
    writeBucket: (state, bucket, versionId, index) => writeFactBucket(artifactStore, state, bucket, versionId, index, observedAt),
  });
}

export function readerEdgeSupervisorFailure(outcome: ReaderEdgePublicationOutcome) {
  return outcome.ok ? null : { taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
    detail: outcome.detail ?? "Reader pages could not be updated." };
}
