import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { PromotedPointerIdentity } from "../civic-data/types.ts";
import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  meetingHistoryContract,
  type HeldMeetingPartition,
  type MeetingPartitionContract,
} from "../civic-data/meeting-partitions.ts";
import { meetingPartitionFreshnessMs } from "../civic-data/contracts.ts";
import {
  composeMeetingBody,
  composeMeetingBodyHistory,
  divisionOf,
  emptyMeetingIndexRow,
  encodeMeetingBlob,
  meetingBodyPointerKey,
  meetingBodyRowScope,
  meetingCompositionOf,
  meetingIndexRowScope,
  meetingStateOf,
  MEETING_BODY_FORMAT_VERSION,
  placesOf,
  readerIndexOf,
  sha256OfJson,
  type BodyHistoryRead,
  type BodyPartitionRead,
  type MeetingBodyPointer,
  type MeetingBodyRecord,
  type MeetingBodyRow,
  type MeetingIndexRow,
  type MeetingIndexRowBody,
  type MeetingStateIndex,
} from "./body-records.ts";
import type { ReaderArtifactStore } from "./edge-store.ts";
import { confirmationCheckedAt, laterCheck, meetingFreshChecks, sameMeetingFreshChecks, type FreshCheckCoupling } from "./fresh-checks.ts";
import { MEETINGS_RECORD_CLASS, readMeetingPartitionProjection, type MeetingsSnapshot } from "./snapshot.ts";

const HISTORY_MAX_AGE_MS = 100 * 365 * 86_400_000;
const INDEX_CONTRACT = "meetings-index";

export interface RegistryBodyLite {
  readonly id: string;
  readonly ocdId: string | null;
  readonly alsoServesOcdIds?: readonly string[];
}

export interface MeetingRegistryRead {
  readonly bodies: readonly RegistryBodyLite[];
}

export interface MeetingBodyPublicationStats {
  readonly states: string[];
  /** Bodies whose partitions were read again and composed. */
  composed: number;
  /** Composed bodies whose content matched what they already held, so no record was written. */
  unchanged: number;
  /** Bodies whose only change was a newer check. */
  checkedOnly: number;
  /** Fields a better source replaced in the bodies composed this pass. */
  superseded: number;
  recordsWritten: number;
  rowsWritten: number;
  /** Body pointers moved: a new record, or a newer check. */
  pointersWritten: number;
  indexesWritten: number;
  bytesWritten: number;
  /** Bodies kept at their previous record because their partitions could not be composed. */
  readonly failed: { readonly bodyId: string; readonly error: string }[];
}

export type MeetingStateEntry =
  | { readonly versionId: string; readonly value: MeetingStateIndex }
  | { readonly versionId: string; readonly carried: true };

export interface MeetingBodyPlan {
  readonly entries: Readonly<Record<string, MeetingStateEntry>>;
  readonly stats: MeetingBodyPublicationStats;
  /** Clears the queued scopes this plan covered; run once the manifest naming its indexes is written. */
  readonly settle: () => Promise<void>;
}

export interface MeetingBodyPublicationInput {
  readonly store: RoutineDataStore;
  readonly artifacts: ReaderArtifactStore;
  readonly now: string;
  /** The served manifest's index references, by state. */
  readonly served: Readonly<Record<string, { readonly version: string }>> | undefined;
  /** The version of a state's registry now, so a changed territory is noticed without reading the registry. */
  readonly registryVersion: (state: string) => string | null;
  readonly registry: (state: string) => Promise<MeetingRegistryRead | null>;
}

interface Layout {
  readonly scopes: Map<string, { readonly contract: MeetingPartitionContract; readonly history: boolean }>;
  readonly regularByBody: Map<string, MeetingPartitionContract[]>;
  readonly familyByState: Map<string, MeetingPartitionContract>;
  readonly bodiesByState: Map<string, Set<string>>;
  readonly states: Set<string>;
  readonly heldBySuccessor: Map<string, HeldMeetingPartition>;
}

const stateOfContract = (contract: MeetingPartitionContract): string =>
  contract.derivedFamily !== null ? contract.derivedFamily.slice(3) : meetingStateOf(contract.ocdId ?? contract.bodyId);

function layoutOf(): Layout {
  const layout: Layout = { scopes: new Map(), regularByBody: new Map(), familyByState: new Map(), bodiesByState: new Map(), states: new Set(),
    heldBySuccessor: new Map(HELD_MEETING_PARTITIONS.map((held) => [held.successorId, held])) };
  for (const contract of MEETING_PARTITION_CONTRACTS) {
    const state = stateOfContract(contract);
    layout.states.add(state);
    layout.scopes.set(contract.scope, { contract, history: false });
    layout.scopes.set(meetingHistoryContract(contract).scope, { contract, history: true });
    if (contract.derivedFamily !== null) { layout.familyByState.set(state, contract); continue; }
    layout.regularByBody.set(contract.bodyId, [...layout.regularByBody.get(contract.bodyId) ?? [], contract]);
    if (!layout.bodiesByState.has(state)) layout.bodiesByState.set(state, new Set());
    layout.bodiesByState.get(state)!.add(contract.bodyId);
  }
  for (const held of HELD_MEETING_PARTITIONS) {
    const successor = MEETING_PARTITION_CONTRACTS.find((contract) => contract.id === held.successorId);
    if (successor) layout.scopes.set(held.scope, { contract: successor, history: false });
  }
  return layout;
}

interface Pass extends MeetingBodyPublicationInput {
  readonly layout: Layout;
  readonly stats: MeetingBodyPublicationStats;
  readonly families: Map<string, Promise<{ readonly read: CivicDataReadResult<MeetingsSnapshot>; readonly members: ReadonlySet<string> }>>;
  readonly registries: Map<string, Promise<MeetingRegistryRead | null>>;
  /** Pointer identities already read this pass; null is a scope with no pointer. */
  readonly identities: Map<string, PromotedPointerIdentity | null>;
  /** Body pointers already read this pass, by key; null is a body with none. */
  readonly pointers: Map<string, { readonly value: MeetingBodyPointer; readonly etag: string | null } | null>;
}

const IDENTITY_BATCH = 500;

/** The pointer identities of these scopes, each read once per pass and in batches. */
async function identitiesOf(pass: Pass, scopes: readonly string[]): Promise<ReadonlyMap<string, PromotedPointerIdentity>> {
  const missing = [...new Set(scopes)].filter((scope) => !pass.identities.has(scope));
  for (let at = 0; at < missing.length; at += IDENTITY_BATCH) {
    const batch = missing.slice(at, at + IDENTITY_BATCH);
    const found = new Map((await pass.store.readPromotionIdentities(MEETINGS_RECORD_CLASS, batch)).map((identity) => [identity.scope, identity] as const));
    for (const scope of batch) pass.identities.set(scope, found.get(scope) ?? null);
  }
  return new Map(scopes.flatMap((scope) => { const identity = pass.identities.get(scope); return identity ? [[scope, identity] as const] : []; }));
}

const readOptions = (pass: Pass) => ({ store: pass.store, now: pass.now, maxAgeMs: meetingPartitionFreshnessMs(pass.now), bypassCache: true });

function familyOf(pass: Pass, contract: MeetingPartitionContract) {
  let held = pass.families.get(contract.id);
  if (!held) {
    held = readMeetingPartitionProjection(contract, readOptions(pass)).then((read) => ({
      read, members: new Set(read.kind === "PROMOTED" ? (read.value.derivedMembers ?? []).map((member) => member.bodyId) : []),
    }));
    pass.families.set(contract.id, held);
  }
  return held;
}

function registryOf(pass: Pass, state: string) {
  let held = pass.registries.get(state);
  if (!held) { held = pass.registry(state); pass.registries.set(state, held); }
  return held;
}

/** The divisions a body serves: the registry's territory for it when it names one, else the door's own. */
function divisionsOf(bodyId: string, registry: MeetingRegistryRead | null, fallback: readonly (string | null | undefined)[]): string[] {
  const named = registry?.bodies.find((row) => row.id === bodyId);
  const ids = named ? [named.ocdId, ...(named.alsoServesOcdIds ?? [])] : fallback;
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0).map(divisionOf))].sort();
}

/** The states a body is filed in: where its divisions lie, or the state its own id names when it serves no division. */
const statesOfBody = (bodyId: string, divisions: readonly string[]): string[] =>
  divisions.length === 0 ? [meetingStateOf(bodyId)] : [...new Set(divisions.map((division) => meetingStateOf(division)))].sort();

async function putBlob(pass: Pass, value: unknown): Promise<string> {
  const bytes = encodeMeetingBlob(value);
  pass.stats.bytesWritten += bytes.byteLength;
  return pass.artifacts.putImmutable(bytes, "json.gz");
}

/** A retired route's held version is read through the successor's contract, under the held partition's own identity. */
const heldContract = (successor: MeetingPartitionContract, held: HeldMeetingPartition): MeetingPartitionContract =>
  ({ ...successor, id: held.id, scope: held.scope, meetingSource: held.meetingSource, bodyId: held.bodyId });

interface BodyWork {
  readonly bodyId: string;
  readonly entry: MeetingIndexRowBody | undefined;
  readonly dirtyFamily: boolean;
  readonly force: boolean;
}

/** What one state files for a body: the pointer readers follow, and the row when its content or its states changed. */
interface Filed {
  readonly pointer: MeetingBodyPointer;
  readonly row: MeetingBodyRow | null;
  readonly couplings: readonly FreshCheckCoupling[];
  readonly divisions: readonly string[];
  readonly family: boolean;
}

type Composed =
  | { readonly kind: "SAME" }
  | { readonly kind: "ABSENT" }
  | { readonly kind: "EMPTY" }
  | { readonly kind: "FILED"; readonly filed: Filed };

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The checks a body shows now: each coupled version's newest confirmation as of its pointer. */
function currentChecks(couplings: readonly FreshCheckCoupling[], identities: ReadonlyMap<string, PromotedPointerIdentity>, scopeOf: ReadonlyMap<string, string>) {
  return meetingFreshChecks(couplings.map((coupling) => {
    if (coupling.routes === undefined) return coupling;
    const identity = identities.get(scopeOf.get(coupling.contractId) ?? "");
    return { ...coupling, checkedAt: laterCheck(coupling.checkedAt ?? null, confirmationCheckedAt(identity?.latestConfirmation, coupling.versionId, true)) };
  }));
}

type HeldPointer = { readonly value: MeetingBodyPointer; readonly etag: string | null } | null;

async function heldPointer(pass: Pass, state: string, bodyId: string): Promise<HeldPointer> {
  const key = meetingBodyPointerKey(state, bodyId);
  if (!pass.pointers.has(key)) pass.pointers.set(key, await pass.artifacts.readJsonPointer<MeetingBodyPointer>(key));
  return pass.pointers.get(key)!;
}

/** Points a body's state at its record; a pointer already saying this writes nothing. */
async function putPointer(pass: Pass, state: string, bodyId: string, pointer: MeetingBodyPointer): Promise<void> {
  const key = meetingBodyPointerKey(state, bodyId);
  for (let attempt = 0; ; attempt += 1) {
    const held = await heldPointer(pass, state, bodyId);
    if (held !== null && sameJson(held.value, pointer)) return;
    const written = await pass.artifacts.writeJsonPointer(key, pointer, held?.etag ?? null);
    if (written.modified) {
      pass.pointers.set(key, { value: pointer, etag: written.etag });
      pass.stats.pointersWritten += 1;
      pass.stats.bytesWritten += JSON.stringify(pointer).length;
      return;
    }
    pass.pointers.delete(key);
    if (attempt >= 3) throw new Error(`MEETING_POINTER_RACED:${key}`);
  }
}

/** Reads the partitions one body lives in and composes it; reads nothing when its coupled versions are the ones it already holds. */
async function composeBody(pass: Pass, state: string, work: BodyWork): Promise<Composed> {
  const { layout, store } = pass;
  const regular = layout.regularByBody.get(work.bodyId) ?? [];
  const family = layout.familyByState.get(state) ?? null;
  const inFamily = family !== null && (work.entry?.family === true ||
    (work.dirtyFamily || work.entry === undefined) && (await familyOf(pass, family)).members.has(work.bodyId));
  const live = [...regular, ...(inFamily && family !== null ? [family] : [])];
  if (live.length === 0) return { kind: "ABSENT" };

  const histories = live.map((contract) => meetingHistoryContract(contract));
  const scopes = [...live.flatMap((contract) => [contract.scope, ...(layout.heldBySuccessor.has(contract.id) ? [layout.heldBySuccessor.get(contract.id)!.scope] : [])]),
    ...histories.map((contract) => contract.scope)];
  const identities = await identitiesOf(pass, scopes);
  const standing = live.map((contract) => {
    const held = layout.heldBySuccessor.get(contract.id) ?? null;
    return identities.has(contract.scope) ? { contract, held: null } : { contract, held: held !== null && identities.has(held.scope) ? held : null };
  }).filter(({ contract, held }) => identities.has(contract.scope) || held !== null);
  if (standing.length === 0) return { kind: "ABSENT" };
  const couplings: FreshCheckCoupling[] = [
    ...standing.map(({ contract, held }) => ({ contractId: held ? held.id : contract.id, versionId: identities.get(held ? held.scope : contract.scope)!.versionId })),
    ...histories.flatMap((contract) => identities.has(contract.scope) ? [{ contractId: contract.id, versionId: identities.get(contract.scope)!.versionId }] : []),
  ];
  const composition = meetingCompositionOf(couplings);
  const held = (await heldPointer(pass, state, work.bodyId))?.value ?? null;
  const filesFamily = inFamily && family !== null;

  if (held !== null && work.entry !== undefined && held.composition === composition && !work.force) {
    const prior = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, meetingBodyRowScope(state, work.bodyId));
    if (prior !== null) {
      const scopeOf = new Map(standing.map(({ contract, held: successor }) => [successor ? successor.id : contract.id, successor ? successor.scope : contract.scope] as const)
        .concat(histories.map((contract) => [contract.id, contract.scope] as const)));
      const checks = currentChecks(prior.composedFrom as readonly FreshCheckCoupling[], identities, scopeOf);
      const next = { checkedAt: laterCheck(held.checks.checkedAt, checks.checkedAt), routes: checks.routes };
      if (next.checkedAt === held.checks.checkedAt && sameMeetingFreshChecks(next.routes, held.checks.routes)) return { kind: "SAME" };
      pass.stats.checkedOnly += 1;
      return { kind: "FILED", filed: { pointer: { ...held, checks: next }, row: null, couplings: [], divisions: work.entry.divisions, family: work.entry.family } };
    }
  }

  const reads: BodyPartitionRead[] = [];
  for (const { contract, held: successor } of standing) {
    const read = contract.derivedFamily !== null ? (await familyOf(pass, contract)).read
      : successor ? await readMeetingPartitionProjection(heldContract(contract, successor), readOptions(pass))
        : await readMeetingPartitionProjection(contract, readOptions(pass));
    if (read.kind === "STORE_UNREACHABLE") throw new Error(`MEETING_PARTITION_UNREADABLE:${contract.id}: ${read.detail}`);
    reads.push({ partition: contract, held: successor, read });
  }
  const historyReads: BodyHistoryRead[] = [];
  for (const contract of histories.filter((row) => identities.has(row.scope))) {
    const read = await readMeetingPartitionProjection(contract, { ...readOptions(pass), maxAgeMs: HISTORY_MAX_AGE_MS });
    if (read.kind === "STORE_UNREACHABLE") throw new Error(`MEETING_HISTORY_UNREADABLE:${contract.id}: ${read.detail}`);
    historyReads.push({ contractId: contract.id, scope: contract.scope, versionId: read.kind === "PROMOTED" ? read.metadata.versionId : null, value: read.kind === "PROMOTED" ? read.value : null });
  }
  const registry = await registryOf(pass, state);
  const own = reads.flatMap(({ read }) => read.kind === "PROMOTED" ? read.value.meetings.filter((meeting) => meeting.bodyId === work.bodyId).map((meeting) => meeting.ocdId) : []);
  const divisions = divisionsOf(work.bodyId, registry, [regular[0]?.ocdId, ...own]);
  const composed = composeMeetingBody({ bodyId: work.bodyId, divisions, reads, histories: historyReads });
  if (composed === null) return { kind: "EMPTY" };
  pass.stats.composed += 1;
  pass.stats.superseded += composed.snapshot.meetings.reduce((count, meeting) => count + (meeting.publicationConflicts?.length ?? 0), 0);

  const history = composeMeetingBodyHistory(work.bodyId, historyReads, composed.snapshot.generatedAt);
  if (composed.snapshot.meetings.length === 0 && history === null && composed.snapshot.sources.every((source) => source.ok)) return { kind: "EMPTY" };
  const through = { sourceThrough: composed.sourceThrough, retrievedAt: composed.retrievedAt, promotedThrough: composed.promotedThrough };
  const content = sha256OfJson({ snapshot: composed.snapshot, history, through });
  const checks = meetingFreshChecks(composed.couplings);
  const next = { checkedAt: checks.checkedAt, routes: checks.routes };
  const unchanged = held !== null && held.content === content;
  const refiled = work.entry === undefined || !sameJson(statesOfBody(work.bodyId, work.entry.divisions), statesOfBody(work.bodyId, divisions));
  if (unchanged) pass.stats.unchanged += 1;
  if (unchanged && !refiled && !work.force) {
    const pointer = { ...held, composition, checks: next };
    return sameJson(pointer, held) && work.entry !== undefined && sameJson(work.entry.divisions, divisions) && work.entry.family === filesFamily
      ? { kind: "SAME" }
      : { kind: "FILED", filed: { pointer, row: null, couplings: composed.couplings, divisions, family: filesFamily } };
  }
  let recordKey: string;
  if (unchanged && held !== null) recordKey = held.record;
  else {
    const agenda = composed.snapshot.agendaDocuments.length > 0 ? await putBlob(pass, composed.snapshot.agendaDocuments) : null;
    const historyKey = history === null ? null : await putBlob(pass, history);
    const record: MeetingBodyRecord = { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId: work.bodyId, snapshot: { ...composed.snapshot, agendaDocuments: [] }, agenda, history: historyKey, ...through };
    pass.stats.recordsWritten += 1;
    recordKey = await putBlob(pass, record);
  }
  const row: MeetingBodyRow = { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId: work.bodyId, snapshot: composed.snapshot, historyScopes: historyReads.map((read) => read.scope), ...through };
  const pointer: MeetingBodyPointer = { formatVersion: MEETING_BODY_FORMAT_VERSION, record: recordKey, checks: next, content, composition };
  return { kind: "FILED", filed: { pointer, row: unchanged && !refiled ? null : row, couplings: composed.couplings, divisions, family: filesFamily } };
}

async function writeRow(pass: Pass, state: string, filed: Filed): Promise<void> {
  const row = filed.row!;
  const scope = meetingBodyRowScope(state, row.bodyId);
  const prior = await pass.store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, scope);
  const result = await pass.store.writePreparedReaderProjection({
    recordClass: MEETINGS_RECORD_CLASS, scope, payload: row, composedFrom: filed.couplings, factSha256: filed.pointer.content,
    generatedAt: row.snapshot.generatedAt, composedAt: pass.now, sourceThrough: row.sourceThrough, retrievedAt: row.retrievedAt, promotedThrough: row.promotedThrough,
  }, prior?.sequence ?? null);
  if (!result.published) throw new Error(`MEETING_BODY_ROW_RACED:${scope}`);
  pass.stats.rowsWritten += 1;
  pass.stats.bytesWritten += JSON.stringify(row).length;
}

/** The row first, so a pointer never names a record the database cannot back up. */
async function file(pass: Pass, state: string, bodyId: string, filed: Filed): Promise<void> {
  if (filed.row !== null) await writeRow(pass, state, filed);
  await putPointer(pass, state, bodyId, filed.pointer);
}

interface StateRound {
  readonly copies: ReadonlyMap<string, Filed>;
  readonly removals: ReadonlySet<string>;
}

interface StateOutcome {
  readonly entry: MeetingStateEntry;
  readonly failed: boolean;
  /** Bodies this state's composition filed in another state, and bodies it no longer files in one. */
  readonly copies: ReadonlyMap<string, Map<string, Filed>>;
  readonly removals: ReadonlyMap<string, Set<string>>;
}

async function processState(pass: Pass, state: string, dirty: ReadonlySet<string>, round: StateRound | null): Promise<StateOutcome | null> {
  const { store, layout } = pass;
  const indexScope = meetingIndexRowScope(state);
  const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, indexScope);
  const prior = row === null ? null : row.payload as MeetingIndexRow;
  const servedVersion = pass.served?.[state]?.version ?? null;
  const priorSha = row === null ? null : String((row.composedFrom as readonly FreshCheckCoupling[])[0]?.versionId ?? "");
  const registryVersion = pass.registryVersion(state);
  const territoryChanged = prior !== null && prior.registryVersion !== registryVersion;
  const idle = prior !== null && dirty.size === 0 && round === null && !territoryChanged;
  if (idle) return priorSha === servedVersion ? null : { entry: { versionId: priorSha!, value: readerIndexOf(prior) }, failed: false, copies: new Map(), removals: new Map() };

  const bodies: Record<string, MeetingIndexRowBody> = { ...prior?.bodies };
  const work = new Map<string, BodyWork>();
  const add = (bodyId: string, dirtyFamily = false, force = false) => {
    const held = work.get(bodyId);
    work.set(bodyId, { bodyId, entry: bodies[bodyId], dirtyFamily: dirtyFamily || (held?.dirtyFamily ?? false), force: force || (held?.force ?? false) });
  };
  const family = layout.familyByState.get(state) ?? null;
  if (prior === null) {
    for (const bodyId of layout.bodiesByState.get(state) ?? []) add(bodyId);
    if (family !== null) for (const bodyId of (await familyOf(pass, family)).members) add(bodyId, true);
  } else {
    for (const scope of dirty) {
      const hit = layout.scopes.get(scope);
      if (hit === undefined) continue;
      const contract = hit.contract;
      if (contract.derivedFamily !== null) {
        for (const [bodyId, entry] of Object.entries(bodies)) if (entry.family) add(bodyId, !hit.history);
        if (!hit.history) for (const bodyId of (await familyOf(pass, contract)).members) add(bodyId, true);
      } else add(contract.bodyId);
    }
    if (territoryChanged) {
      const registry = await registryOf(pass, state);
      for (const [bodyId, entry] of Object.entries(bodies)) {
        const divisions = divisionsOf(bodyId, registry, entry.divisions);
        if (divisions.join("|") !== entry.divisions.join("|")) add(bodyId, false, true);
      }
    }
  }

  const wanted = [...work.keys()].flatMap((bodyId) => (layout.regularByBody.get(bodyId) ?? []).flatMap((contract) =>
    [contract.scope, meetingHistoryContract(contract).scope, ...(layout.heldBySuccessor.has(contract.id) ? [layout.heldBySuccessor.get(contract.id)!.scope] : [])]));
  await identitiesOf(pass, wanted);

  const copies = new Map<string, Map<string, Filed>>();
  const removals = new Map<string, Set<string>>();
  const remove = (target: string, bodyId: string) => { const held = removals.get(target) ?? new Set<string>(); held.add(bodyId); removals.set(target, held); };
  let failed = false;
  let changed = prior === null || territoryChanged;
  const keep = (bodyId: string, entry: MeetingIndexRowBody) => { if (!sameJson(bodies[bodyId], entry)) { bodies[bodyId] = entry; changed = true; } };
  for (const item of work.values()) {
    try {
      const result = await composeBody(pass, state, item);
      if (result.kind === "SAME" || result.kind === "ABSENT") continue;
      if (result.kind === "EMPTY") {
        if (item.entry !== undefined) {
          for (const gone of statesOfBody(item.bodyId, item.entry.divisions)) if (gone !== state) remove(gone, item.bodyId);
          delete bodies[item.bodyId]; changed = true;
        }
        continue;
      }
      const { filed } = result;
      const targets = statesOfBody(item.bodyId, filed.divisions);
      const moved = item.entry === undefined ? [] : statesOfBody(item.bodyId, item.entry.divisions).filter((held) => !targets.includes(held));
      for (const gone of moved) remove(gone, item.bodyId);
      for (const target of targets) {
        if (target === state) {
          await file(pass, state, item.bodyId, filed);
          keep(item.bodyId, { divisions: filed.divisions, family: filed.family });
        } else if (filed.row !== null) {
          const held = copies.get(target) ?? new Map<string, Filed>();
          held.set(item.bodyId, filed); copies.set(target, held);
        } else await putPointer(pass, target, item.bodyId, filed.pointer);
      }
      if (!targets.includes(state)) { delete bodies[item.bodyId]; changed = true; }
    } catch (error) {
      failed = true;
      pass.stats.failed.push({ bodyId: item.bodyId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const [bodyId, filed] of round?.copies ?? []) {
    const held = await heldPointer(pass, state, bodyId);
    await file(pass, state, bodyId, held?.value.content === filed.pointer.content ? { ...filed, row: null } : filed);
    keep(bodyId, { divisions: filed.divisions, family: filed.family });
  }
  for (const bodyId of round?.removals ?? []) if (bodies[bodyId] !== undefined) { delete bodies[bodyId]; changed = true; }

  const sorted = Object.fromEntries(Object.entries(bodies).sort(([a], [b]) => (a < b ? -1 : 1)));
  const index: MeetingIndexRow = { ...(prior ?? emptyMeetingIndexRow(state, registryVersion)), registryVersion, bodies: sorted, places: placesOf(sorted) };
  const reader = readerIndexOf(index);
  const sha = sha256OfJson(reader);
  const rowSha = sha256OfJson(index);
  if (row !== null && rowSha === row.factSha256) return { entry: { versionId: sha, ...(servedVersion === sha ? { carried: true as const } : { value: reader }) }, failed, copies, removals };
  if (!changed && row !== null) return { entry: { versionId: priorSha!, ...(servedVersion === priorSha ? { carried: true as const } : { value: readerIndexOf(prior!) }) }, failed, copies, removals };
  const result = await store.writePreparedReaderProjection({
    recordClass: MEETINGS_RECORD_CLASS, scope: indexScope, payload: index, composedFrom: [{ contractId: INDEX_CONTRACT, versionId: sha }], factSha256: rowSha,
    generatedAt: pass.now, composedAt: pass.now, sourceThrough: null, retrievedAt: null, promotedThrough: null,
  }, row?.sequence ?? null);
  if (!result.published) throw new Error(`MEETING_INDEX_RACED:${indexScope}`);
  pass.stats.indexesWritten += 1;
  pass.stats.bytesWritten += JSON.stringify(index).length;
  return { entry: { versionId: sha, value: reader }, failed, copies, removals };
}

/**
 * What the queued partition changes owe the reader edge: every changed body recomposed and filed under its states, and each
 * state's index written again only when it differs. Bodies that did not change write nothing.
 */
export async function planMeetingBodies(input: MeetingBodyPublicationInput): Promise<MeetingBodyPlan> {
  const { store } = input;
  if (store.readMeetingQueue === undefined || store.settleMeetingQueue === undefined) throw new Error("MEETING_QUEUE_UNAVAILABLE");
  const layout = layoutOf();
  const queued = await store.readMeetingQueue();
  const dirty = new Map<string, Set<string>>();
  const covered: { readonly scope: string; readonly queuedAt: string; readonly state: string | null }[] = [];
  for (const row of queued) {
    const hit = layout.scopes.get(row.scope);
    const state = hit === undefined ? null : stateOfContract(hit.contract);
    covered.push({ ...row, state });
    if (state !== null) dirty.set(state, (dirty.get(state) ?? new Set()).add(row.scope));
  }
  const pass: Pass = { ...input, layout, families: new Map(), registries: new Map(), identities: new Map(), pointers: new Map(),
    stats: { states: [], composed: 0, unchanged: 0, checkedOnly: 0, superseded: 0, recordsWritten: 0, rowsWritten: 0, pointersWritten: 0, indexesWritten: 0, bytesWritten: 0, failed: [] } };
  const entries: Record<string, MeetingStateEntry> = Object.fromEntries(Object.entries(input.served ?? {}).map(([state, ref]) => [state, { versionId: ref.version, carried: true as const }]));
  const failedStates = new Set<string>();
  const extras = new Map<string, { copies: Map<string, Filed>; removals: Set<string> }>();
  const run = async (state: string, round: StateRound | null) => {
    const outcome = await processState(pass, state, round === null ? dirty.get(state) ?? new Set() : new Set(), round);
    // What a state read is not kept for the next, so a pass holds one state at a time.
    pass.identities.clear(); pass.pointers.clear(); pass.families.clear(); pass.registries.clear();
    if (outcome === null) return;
    if (!pass.stats.states.includes(state)) pass.stats.states.push(state);
    entries[state] = outcome.entry;
    if (outcome.failed) failedStates.add(state);
    for (const [target, copies] of outcome.copies) {
      const held = extras.get(target) ?? { copies: new Map<string, Filed>(), removals: new Set<string>() };
      for (const [bodyId, copy] of copies) { held.copies.set(bodyId, copy); held.removals.delete(bodyId); }
      extras.set(target, held);
    }
    for (const [target, bodies] of outcome.removals) {
      const held = extras.get(target) ?? { copies: new Map<string, Filed>(), removals: new Set<string>() };
      for (const bodyId of bodies) if (!held.copies.has(bodyId)) held.removals.add(bodyId);
      extras.set(target, held);
    }
  };
  for (const state of [...layout.states].sort()) await run(state, null);
  for (const [state, round] of extras) await run(state, round);
  return {
    entries, stats: pass.stats,
    settle: async () => {
      const settled = covered.filter((row) => row.state === null || !failedStates.has(row.state));
      if (settled.length > 0) await store.settleMeetingQueue!(settled.map(({ scope, queuedAt }) => ({ scope, queuedAt })));
    },
  };
}
