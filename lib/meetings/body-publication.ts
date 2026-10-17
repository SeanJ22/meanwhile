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
  emptyMeetingStateIndex,
  encodeMeetingBlob,
  meetingBodyRowScope,
  meetingCompositionOf,
  meetingIndexRowScope,
  meetingStateOf,
  MEETING_BODY_FORMAT_VERSION,
  NATIONAL_MEETING_STATE,
  placesOf,
  sha256OfJson,
  type BodyHistoryRead,
  type BodyPartitionRead,
  type MeetingBlobRef,
  type MeetingBodyRecord,
  type MeetingBodyRow,
  type MeetingIndexBody,
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
  recordsWritten: number;
  rowsWritten: number;
  indexesWritten: number;
  bytesWritten: number;
  /** Bodies kept at their previous record because their partitions could not be composed. */
  readonly failed: { readonly bodyId: string; readonly error: string }[];
}

export interface MeetingStateEntry {
  readonly versionId: string;
  readonly carried?: true;
  readonly value?: MeetingStateIndex;
}

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

const statesOfDivisions = (divisions: readonly string[]): string[] =>
  divisions.length === 0 ? [NATIONAL_MEETING_STATE] : [...new Set(divisions.map((division) => meetingStateOf(division)))].sort();

async function putBlob(pass: Pass, value: unknown): Promise<MeetingBlobRef> {
  const bytes = encodeMeetingBlob(value);
  const key = await pass.artifacts.putImmutable(bytes, "json.gz");
  pass.stats.bytesWritten += bytes.byteLength;
  return { key, sha: sha256OfJson(value) };
}

/** A retired route's held version is read through the successor's contract, under the held partition's own identity. */
const heldContract = (successor: MeetingPartitionContract, held: HeldMeetingPartition): MeetingPartitionContract =>
  ({ ...successor, id: held.id, scope: held.scope, meetingSource: held.meetingSource, bodyId: held.bodyId });

interface BodyWork {
  readonly bodyId: string;
  readonly entry: MeetingIndexBody | undefined;
  readonly dirtyFamily: boolean;
  readonly force: boolean;
}

type Composed =
  | { readonly kind: "SAME" }
  | { readonly kind: "ABSENT" }
  | { readonly kind: "ENTRY"; readonly entry: MeetingIndexBody; readonly checkedOnly: boolean }
  | { readonly kind: "COMPOSED"; readonly entry: MeetingIndexBody; readonly row: MeetingBodyRow; readonly couplings: readonly FreshCheckCoupling[]; readonly divisions: readonly string[] };

const sameEntry = (left: MeetingIndexBody, right: MeetingIndexBody): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The checks a body shows now: each coupled version's newest confirmation as of its pointer. */
function currentChecks(couplings: readonly FreshCheckCoupling[], identities: ReadonlyMap<string, PromotedPointerIdentity>, scopeOf: ReadonlyMap<string, string>) {
  return meetingFreshChecks(couplings.map((coupling) => {
    if (coupling.routes === undefined) return coupling;
    const identity = identities.get(scopeOf.get(coupling.contractId) ?? "");
    return { ...coupling, checkedAt: laterCheck(coupling.checkedAt ?? null, confirmationCheckedAt(identity?.latestConfirmation, coupling.versionId, true)) };
  }));
}

/** Reads the partitions one body lives in and composes it; reads nothing when its coupled versions are the ones it already holds. */
async function composeBody(pass: Pass, state: string, work: BodyWork): Promise<Composed> {
  const { layout, store } = pass;
  const regular = layout.regularByBody.get(work.bodyId) ?? [];
  const family = layout.familyByState.get(state) ?? null;
  const inFamily = family !== null && (work.entry?.contracts.includes(family.id) === true ||
    (work.dirtyFamily || work.entry === undefined) && (await familyOf(pass, family)).members.has(work.bodyId));
  const live = [...regular, ...(inFamily && family !== null ? [family] : [])];
  if (live.length === 0) return { kind: "ABSENT" };

  const histories = live.map((contract) => meetingHistoryContract(contract));
  const scopes = [...live.flatMap((contract) => [contract.scope, ...(layout.heldBySuccessor.has(contract.id) ? [layout.heldBySuccessor.get(contract.id)!.scope] : [])]),
    ...histories.map((contract) => contract.scope)];
  const identities = new Map((await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, scopes)).map((identity) => [identity.scope, identity] as const));
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

  if (work.entry !== undefined && work.entry.composition === composition && !work.force) {
    const prior = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, meetingBodyRowScope(state, work.bodyId));
    if (prior === null) return { kind: "ABSENT" };
    const scopeOf = new Map(standing.map(({ contract, held }) => [held ? held.id : contract.id, held ? held.scope : contract.scope] as const)
      .concat(histories.map((contract) => [contract.id, contract.scope] as const)));
    const checks = currentChecks(prior.composedFrom as readonly FreshCheckCoupling[], identities, scopeOf);
    const next = { checkedAt: laterCheck(work.entry.checks.checkedAt, checks.checkedAt), routes: checks.routes };
    if (next.checkedAt === work.entry.checks.checkedAt && sameMeetingFreshChecks(next.routes, work.entry.checks.routes)) return { kind: "SAME" };
    return { kind: "ENTRY", entry: { ...work.entry, checks: next }, checkedOnly: true };
  }

  const reads: BodyPartitionRead[] = [];
  for (const { contract, held } of standing) {
    const read = contract.derivedFamily !== null ? (await familyOf(pass, contract)).read
      : held ? await readMeetingPartitionProjection(heldContract(contract, held), readOptions(pass))
        : await readMeetingPartitionProjection(contract, readOptions(pass));
    if (read.kind === "STORE_UNREACHABLE") throw new Error(`MEETING_PARTITION_UNREADABLE:${contract.id}: ${read.detail}`);
    reads.push({ partition: contract, held, read });
  }
  const historyReads: BodyHistoryRead[] = [];
  for (const contract of histories.filter((row) => identities.has(row.scope))) {
    const read = await readMeetingPartitionProjection(contract, { ...readOptions(pass), maxAgeMs: HISTORY_MAX_AGE_MS });
    if (read.kind === "STORE_UNREACHABLE") throw new Error(`MEETING_HISTORY_UNREADABLE:${contract.id}: ${read.detail}`);
    historyReads.push({ contractId: contract.id, scope: contract.scope, versionId: read.kind === "PROMOTED" ? read.metadata.versionId : null, value: read.kind === "PROMOTED" ? read.value : null });
  }
  const registry = await registryOf(pass, state);
  const first = reads.find(({ read }) => read.kind === "PROMOTED");
  const doorDivisions = [regular[0]?.ocdId, ...(first?.read.kind === "PROMOTED" ? first.read.value.meetings.slice(0, 1).map((meeting) => meeting.ocdId) : [])];
  const divisions = divisionsOf(work.bodyId, registry, doorDivisions);
  const composed = composeMeetingBody({ bodyId: work.bodyId, divisions, reads, histories: historyReads });
  if (composed === null) return { kind: "ABSENT" };
  pass.stats.composed += 1;

  const history = composeMeetingBodyHistory(work.bodyId, historyReads, composed.snapshot.generatedAt);
  const content = sha256OfJson({ snapshot: composed.snapshot, history });
  const checks = meetingFreshChecks(composed.couplings);
  const base = {
    composition, contracts: composed.couplings.map((coupling) => coupling.contractId).sort(), divisions,
    meetings: composed.snapshot.meetings.length, generatedAt: composed.snapshot.generatedAt, sourceThrough: composed.sourceThrough,
    retrievedAt: composed.retrievedAt, promotedThrough: composed.promotedThrough, checks: { checkedAt: checks.checkedAt, routes: checks.routes }, content,
  };
  if (work.entry !== undefined && work.entry.content === content) {
    const entry: MeetingIndexBody = { ...base, record: work.entry.record };
    pass.stats.unchanged += 1;
    return sameEntry(entry, work.entry) ? { kind: "SAME" } : { kind: "ENTRY", entry, checkedOnly: false };
  }
  const agenda = composed.snapshot.agendaDocuments.length > 0 ? await putBlob(pass, composed.snapshot.agendaDocuments) : null;
  const historyRef = history === null ? null : { ...await putBlob(pass, history), meetings: history.meetings.length };
  const record: MeetingBodyRecord = { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId: work.bodyId, snapshot: { ...composed.snapshot, agendaDocuments: [] }, agenda, history: historyRef };
  pass.stats.recordsWritten += 1;
  const entry: MeetingIndexBody = { ...base, record: await putBlob(pass, record) };
  const row: MeetingBodyRow = { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId: work.bodyId, snapshot: composed.snapshot, historyScopes: historyReads.map((read) => read.scope) };
  return { kind: "COMPOSED", entry, row, couplings: composed.couplings, divisions };
}

async function writeRow(pass: Pass, state: string, entry: MeetingIndexBody, row: MeetingBodyRow, couplings: readonly FreshCheckCoupling[]): Promise<void> {
  const scope = meetingBodyRowScope(state, row.bodyId);
  const prior = await pass.store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, scope);
  const result = await pass.store.writePreparedReaderProjection({
    recordClass: MEETINGS_RECORD_CLASS, scope, payload: row, composedFrom: couplings, factSha256: entry.content,
    generatedAt: entry.generatedAt, composedAt: pass.now, sourceThrough: entry.sourceThrough, retrievedAt: entry.retrievedAt, promotedThrough: entry.promotedThrough,
  }, prior?.sequence ?? null);
  if (!result.published) throw new Error(`MEETING_BODY_ROW_RACED:${scope}`);
  pass.stats.rowsWritten += 1;
  pass.stats.bytesWritten += JSON.stringify(row).length;
}

interface Copy {
  readonly entry: MeetingIndexBody;
  readonly row: MeetingBodyRow;
  readonly couplings: readonly FreshCheckCoupling[];
}

interface StateRound {
  readonly copies: ReadonlyMap<string, Copy>;
  readonly removals: ReadonlySet<string>;
}

interface StateOutcome {
  readonly entry: MeetingStateEntry;
  readonly failed: boolean;
  /** Bodies this state's composition filed in another state, and bodies it no longer files in one. */
  readonly copies: ReadonlyMap<string, Map<string, Copy>>;
  readonly removals: ReadonlyMap<string, Set<string>>;
}

async function processState(pass: Pass, state: string, dirty: ReadonlySet<string>, round: StateRound | null): Promise<StateOutcome | null> {
  const { store, layout } = pass;
  const indexScope = meetingIndexRowScope(state);
  const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, indexScope);
  const prior = row === null ? null : row.payload as MeetingStateIndex;
  const servedVersion = pass.served?.[state]?.version ?? null;
  const priorSha = row === null ? null : String((row.composedFrom as readonly FreshCheckCoupling[])[0]?.versionId ?? "");
  const registryVersion = pass.registryVersion(state);
  const territoryChanged = prior !== null && prior.registryVersion !== registryVersion;
  const idle = prior !== null && dirty.size === 0 && round === null && !territoryChanged;
  if (idle) return priorSha === servedVersion ? null : { entry: { versionId: priorSha!, value: prior }, failed: false, copies: new Map(), removals: new Map() };

  const bodies: Record<string, MeetingIndexBody> = { ...prior?.bodies };
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
        for (const [bodyId, entry] of Object.entries(bodies)) if (entry.contracts.includes(contract.id) || entry.contracts.includes(meetingHistoryContract(contract).id)) add(bodyId, !hit.history);
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

  const copies = new Map<string, Map<string, Copy>>();
  const removals = new Map<string, Set<string>>();
  const file = (target: string, bodyId: string, copy: Copy) => {
    const held = copies.get(target) ?? new Map<string, Copy>();
    held.set(bodyId, copy); copies.set(target, held);
  };
  let failed = false;
  let changed = prior === null || territoryChanged;
  for (const item of work.values()) {
    try {
      const result = await composeBody(pass, state, item);
      if (result.kind === "SAME" || result.kind === "ABSENT") continue;
      if (result.kind === "ENTRY") {
        bodies[item.bodyId] = result.entry; changed = true;
        if (result.checkedOnly) pass.stats.checkedOnly += 1;
        continue;
      }
      const targets = statesOfDivisions(result.divisions);
      const moved = item.entry === undefined ? [] : statesOfDivisions(item.entry.divisions).filter((held) => !targets.includes(held));
      for (const gone of moved) { const held = removals.get(gone) ?? new Set<string>(); held.add(item.bodyId); removals.set(gone, held); }
      const copy: Copy = { entry: result.entry, row: result.row, couplings: result.couplings };
      for (const target of targets) {
        if (target === state) {
          await writeRow(pass, state, result.entry, result.row, result.couplings);
          bodies[item.bodyId] = result.entry; changed = true;
        } else file(target, item.bodyId, copy);
      }
      if (!targets.includes(state)) { delete bodies[item.bodyId]; changed = true; }
    } catch (error) {
      failed = true;
      pass.stats.failed.push({ bodyId: item.bodyId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const [bodyId, copy] of round?.copies ?? []) {
    if (bodies[bodyId]?.content !== copy.entry.content) await writeRow(pass, state, copy.entry, copy.row, copy.couplings);
    if (bodies[bodyId] === undefined || !sameEntry(bodies[bodyId]!, copy.entry)) { bodies[bodyId] = copy.entry; changed = true; }
  }
  for (const bodyId of round?.removals ?? []) if (bodies[bodyId] !== undefined) { delete bodies[bodyId]; changed = true; }

  const sorted = Object.fromEntries(Object.entries(bodies).sort(([a], [b]) => (a < b ? -1 : 1)));
  const index: MeetingStateIndex = { ...(prior ?? emptyMeetingStateIndex(state, registryVersion)), registryVersion, bodies: sorted, places: placesOf(sorted) };
  const sha = sha256OfJson(index);
  if (row !== null && sha === priorSha) return { entry: { versionId: sha, ...(servedVersion === sha ? { carried: true as const } : { value: index }) }, failed, copies, removals };
  if (!changed && row !== null) return { entry: { versionId: priorSha!, ...(servedVersion === priorSha ? { carried: true as const } : { value: prior! }) }, failed, copies, removals };
  const result = await store.writePreparedReaderProjection({
    recordClass: MEETINGS_RECORD_CLASS, scope: indexScope, payload: index, composedFrom: [{ contractId: INDEX_CONTRACT, versionId: sha }], factSha256: sha,
    generatedAt: pass.now, composedAt: pass.now, sourceThrough: null, retrievedAt: null, promotedThrough: null,
  }, row?.sequence ?? null);
  if (!result.published) throw new Error(`MEETING_INDEX_RACED:${indexScope}`);
  pass.stats.indexesWritten += 1;
  pass.stats.bytesWritten += JSON.stringify(index).length;
  return { entry: { versionId: sha, value: index }, failed, copies, removals };
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
  const pass: Pass = { ...input, layout, families: new Map(), registries: new Map(),
    stats: { states: [], composed: 0, unchanged: 0, checkedOnly: 0, recordsWritten: 0, rowsWritten: 0, indexesWritten: 0, bytesWritten: 0, failed: [] } };
  const entries: Record<string, MeetingStateEntry> = Object.fromEntries(Object.entries(input.served ?? {}).map(([state, ref]) => [state, { versionId: ref.version, carried: true as const }]));
  const failedStates = new Set<string>();
  const extras = new Map<string, { copies: Map<string, Copy>; removals: Set<string> }>();
  const run = async (state: string, round: StateRound | null) => {
    const outcome = await processState(pass, state, round === null ? dirty.get(state) ?? new Set() : new Set(), round);
    if (outcome === null) return;
    if (!pass.stats.states.includes(state)) pass.stats.states.push(state);
    entries[state] = outcome.entry;
    if (outcome.failed) failedStates.add(state);
    for (const [target, copies] of outcome.copies) {
      const held = extras.get(target) ?? { copies: new Map<string, Copy>(), removals: new Set<string>() };
      for (const [bodyId, copy] of copies) { held.copies.set(bodyId, copy); held.removals.delete(bodyId); }
      extras.set(target, held);
    }
    for (const [target, bodies] of outcome.removals) {
      const held = extras.get(target) ?? { copies: new Map<string, Copy>(), removals: new Set<string>() };
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
