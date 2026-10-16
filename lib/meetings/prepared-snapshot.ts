import { routineScopeState } from "../civic-data/state-scope.ts";
import { factReader } from "../facts/db.ts";
import { createHash } from "node:crypto";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import type { MeetingDocumentCheckPublication, MeetingPublication } from "./edge-artifacts.ts";
import type { MeetingDocumentChecks } from "./document-checks.ts";

import {
  PostgresRoutineDataStore,
  pdcV2CanonicalMeetingFactEvidence,
  type PreparedProjectionCoupling,
  type PreparedReaderProjectionInput,
  type PreparedReaderProjectionRow,
  type RoutineDataStore,
} from "../civic-data/store.ts";
import {
  HELD_MEETING_PARTITIONS,
  MEETING_PARTITION_CONTRACTS,
  heldMeetingPartitionFor,
  meetingPartitionId,
  meetingPartitionOfId,
  meetingHistoryContract,
  type MeetingPartitionContract,
} from "../civic-data/meeting-partitions.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import {
  MEETINGS_RECORD_CLASS,
  MEETINGS_SCOPE,
  MEETINGS_SOURCE_ID,
  readMeetingsProjection,
  type MeetingPartitionReadback,
  type MeetingsProjectionReadResult,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
  type SnapshotCounts,
} from "./snapshot.ts";
import {
  applyMeetingFreshChecks,
  applyDocumentFreshChecks,
  confirmationCheckedAt,
  laterCheck,
  meetingCompositionId,
  meetingFreshChecks,
  type FreshCheckCoupling,
} from "./fresh-checks.ts";
import type { PromotedPointerIdentity } from "../civic-data/types.ts";
import { buildMeetingHistorySnapshot, mergeMeetingHistory } from "../civic-data/meeting-history.ts";
import { meetingCarriesRecords } from "./carries-records.ts";

export const MEETINGS_PREPARED_SCOPE = "composed-reader-snapshot:US";
export const preparedMeetingScope = (state = process.env.WTP_SOURCE_STATE ?? "US") => `composed-reader-snapshot:${routineScopeState(state)}`;

/** The live meeting facts a composition read; any change to them recomposes it. */
const MEETING_FACTS_COUPLING = "meeting-facts";

function couplingFingerprint(coupling: readonly PreparedProjectionCoupling[]): string {
  return [...coupling]
    .map((entry) => `${entry.contractId}=${entry.versionId}`)
    .sort()
    .join("|");
}

/** A composed partition's scope, read from its id: the composition is checked whatever doors this process holds. */
const scopeOfContract = (contractId: string): string | undefined => meetingPartitionOfId(contractId)?.scope;

type CheckedCoupling = FreshCheckCoupling & { readonly meetingChecksVersion?: string };

function withCurrentChecks(
  couplings: readonly FreshCheckCoupling[],
  identityByScope: ReadonlyMap<string, Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation" | "meetingChecksVersion">>,
): CheckedCoupling[] {
  return couplings.map((coupling) => {
    if (coupling.routes === undefined) return coupling;
    const scope = scopeOfContract(coupling.contractId);
    const identity = scope === undefined ? undefined : identityByScope.get(scope);
    const checkedAt = laterCheck(coupling.checkedAt ?? null, confirmationCheckedAt(identity?.latestConfirmation, coupling.versionId, true));
    return { ...coupling, checkedAt, ...(identity?.versionId === coupling.versionId && identity.meetingChecksVersion
      ? { meetingChecksVersion: identity.meetingChecksVersion } : {}) };
  });
}

export interface PreparedMeetingChecks {
  readonly servedGeneratedAt: string | null;
  readonly checkedAt: string | null;
  readonly freshChecks: Readonly<Record<string, string>>;
  readonly composition: string;
  readonly documentChecks: AsyncIterable<MeetingDocumentCheckPublication>;
}

function preparedChecks(generatedAt: string | null, couplings: readonly FreshCheckCoupling[], documentChecks: AsyncIterable<MeetingDocumentCheckPublication>): PreparedMeetingChecks {
  const checks = meetingFreshChecks(couplings);
  return {
    servedGeneratedAt: laterCheck(generatedAt, checks.checkedAt),
    checkedAt: checks.checkedAt,
    freshChecks: checks.routes,
    composition: meetingCompositionId(couplings),
    documentChecks,
  };
}

export type PrepareMeetingSnapshotResult =
  | ({ readonly status: "CURRENT"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string | null } & PreparedMeetingChecks)
  | ({ readonly status: "PUBLISHED"; readonly sequence: number; readonly coupledPartitions: number; readonly generatedAt: string } & PreparedMeetingChecks)
  | { readonly status: "RACED"; readonly sequence: number; readonly coupledPartitions: number }
  | { readonly status: "FAILED"; readonly error: string; readonly lastValidGeneratedAt: string | null }
  | { readonly status: "NOT_COMPOSABLE"; readonly detail: string; readonly lastValidGeneratedAt: string | null };

export const MEETING_LAYOUT_COUPLING = { contractId: "meeting-layout", versionId: "3" } as const;
const HELD_COUPLING_PREFIX = "meeting-collision:";

export interface PreparedMeetingChunk {
  readonly key: string;
  readonly scope: string;
  readonly ocdId: string | null;
  readonly bodyIds: readonly string[];
  readonly meetingIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly fingerprint: string;
  readonly generatedAt: string;
  readonly counts: SnapshotCounts;
  readonly sources: readonly SnapshotSourceReport[];
  readonly composedFrom: readonly FreshCheckCoupling[];
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
}

export interface PreparedMeetingManifest {
  readonly formatVersion: 2;
  readonly chunks: readonly PreparedMeetingChunk[];
  readonly heldChunks: readonly { readonly chunk: PreparedMeetingChunk; readonly detail: string }[];
  readonly unavailableSources: readonly SnapshotSourceReport[];
}

function chunkDocumentChecks(chunk: PreparedMeetingChunk, checked: ReadonlyMap<string, CheckedCoupling>, store: RoutineDataStore): MeetingDocumentCheckPublication | null {
  const members = chunk.composedFrom.flatMap(coupling => {
    const current = checked.get(coupling.contractId), scope = scopeOfContract(coupling.contractId);
    return scope && current?.versionId === coupling.versionId && current.meetingChecksVersion
      ? [{ scope, versionId: coupling.versionId, checksVersion: current.meetingChecksVersion }] : [];
  });
  if (!members.length) return null;
  return { chunkKey: chunk.key, chunkVersion: chunk.scope,
    version: createHash("sha256").update(JSON.stringify(members)).digest("hex"), read: async () => {
      const documents: MeetingDocumentChecks["documents"][number][] = [];
      for (const member of members) {
        const checks = await store.readPromotedMeetingChecks(member.scope, member.versionId, member.checksVersion);
        documents.push(...(checks?.documents ?? []).filter(check => check.contentHash && check.checkedAt));
      }
      documents.sort((a, b) => Date.parse(a.checkedAt!) - Date.parse(b.checkedAt!) || a.url.localeCompare(b.url));
      return { documents };
    } };
}

async function* preparedDocumentChecks(store: RoutineDataStore, scope: string, couplings: readonly CheckedCoupling[], manifest?: PreparedMeetingManifest, expectedSequence?: number): AsyncIterable<MeetingDocumentCheckPublication> {
  if (!couplings.some(coupling => coupling.meetingChecksVersion)) return;
  if (!manifest) {
    const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, scope);
    if (!row) throw new Error("PREPARED_MEETING_CHUNK_MISSING");
    if (expectedSequence !== undefined && row.sequence !== expectedSequence) throw new Error("PREPARED_MEETING_COPY_CHANGED_DURING_READ");
    manifest = meetingManifest(row.payload);
  }
  const checked = new Map(couplings.map(coupling => [coupling.contractId, coupling]));
  for (const chunk of manifest.chunks) {
    const publication = chunkDocumentChecks(chunk, checked, store);
    if (publication) yield publication;
  }
}

function meetingManifest(value: unknown): PreparedMeetingManifest {
  const manifest = value as PreparedMeetingManifest;
  if (manifest?.formatVersion !== 2 || !Array.isArray(manifest.chunks) || !Array.isArray(manifest.heldChunks) ||
      [...manifest.chunks, ...manifest.heldChunks.map(held => held.chunk)].some(chunk =>
        !Array.isArray(chunk.meetingIds) || !Array.isArray(chunk.documentIds))) throw new Error("PREPARED_MEETING_LAYOUT_INVALID");
  return manifest;
}

function observedCouplings(couplings: readonly PreparedProjectionCoupling[]): PreparedProjectionCoupling[] {
  // Rejected versions remain observed without restamping the accepted facts they could not replace.
  const observed = new Map(couplings.filter(entry => entry.contractId.startsWith(HELD_COUPLING_PREFIX))
    .map(entry => [entry.contractId.slice(HELD_COUPLING_PREFIX.length), entry.versionId]));
  return [...couplings.filter(entry => !entry.contractId.startsWith(HELD_COUPLING_PREFIX) && !observed.has(entry.contractId)),
    ...[...observed].map(([contractId, versionId]) => ({ contractId, versionId }))];
}

function chunkCollisions(chunks: readonly PreparedMeetingChunk[]): Map<string, string> {
  const invalid = new Map<string, string>();
  for (const [field, code] of [["meetingIds", "MEETING_PARTITION_ID_COLLISION"], ["documentIds", "MEETING_PARTITION_DOCUMENT_COLLISION"]] as const) {
    const owners = new Map<string, string>();
    for (const chunk of chunks) for (const id of chunk[field]) {
      const owner = owners.get(id);
      if (owner !== undefined && owner !== chunk.key) {
        invalid.set(owner, `${code}:${id}`);
        invalid.set(chunk.key, `${code}:${id}`);
      } else owners.set(id, chunk.key);
    }
  }
  return invalid;
}

function compositionOf(partitions: readonly MeetingPartitionReadback[]): FreshCheckCoupling[] {
  return partitions.flatMap(partition => {
    const accepted = partition.kind === "PROMOTED" && partition.versionId
      ? { contractId: partition.contractId, versionId: partition.versionId }
      : partition.heldFrom;
    return [...(accepted ? [{ contractId: accepted.contractId, versionId: accepted.versionId,
      ...(partition.freshCheck ? { routes: partition.freshCheck.routes, ...(partition.freshCheck.checkedAt ? { checkedAt: partition.freshCheck.checkedAt } : {}) } : {}) }] : []),
    ...(partition.history ? [partition.history] : [])];
  });
}

const latest = (values: readonly (string | null)[]) => values.filter((value): value is string => value !== null).sort().at(-1) ?? null;

async function meetingFactVersions(state: string | undefined): Promise<ReadonlyMap<string, string>> {
  const query = factReader();
  if (!query) return new Map();
  const postal = state?.replace(/^US-/, "");
  const rows = await query(`SELECT e.parent_id AS body_id, coalesce(max(f.id), 0) AS newest,
      count(*) FILTER (WHERE f.status = 'live') AS live
    FROM entity e CROSS JOIN LATERAL (SELECT id,status FROM fact WHERE entity_id=e.id OFFSET 0) f
    WHERE e.kind='meeting' AND ${postal && postal !== "US" ? "e.state=$1::char(2)" : "e.state IS NULL"}
    GROUP BY e.parent_id`, postal && postal !== "US" ? [postal] : []);
  return new Map(rows.filter(row => typeof row.body_id === "string").map(row => [String(row.body_id), `facts:${row.newest}.${row.live}`]));
}

export async function preparePublishedMeetingSnapshot(
  store: RoutineDataStore,
  now: string = new Date().toISOString(),
  options: { readonly aggregate?: () => Promise<MeetingsProjectionReadResult>; readonly state?: string } = {},
): Promise<PrepareMeetingSnapshotResult> {
  const requestedState = options.state ?? process.env.WTP_SOURCE_STATE;
  const state = requestedState ? routineScopeState(requestedState) : undefined;
  await (await import("../doors/meeting-doors.ts")).ensureMeetingDoors(state ? { state } : {});
  const partitions = [...MEETING_PARTITION_CONTRACTS].filter(partition => !state || routineScopeState(partition.bodyId) === state);
  const preparedScope = preparedMeetingScope(state);
  const historyContracts = partitions.map(meetingHistoryContract);
  const identityByScope = new Map<string, PromotedPointerIdentity>();
  let prepared: Awaited<ReturnType<RoutineDataStore["readPreparedReaderProjectionCoupling"]>> = null;
  try {
    for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS,
      [...partitions.map(partition => partition.scope), ...historyContracts.map(contract => contract.scope)])) identityByScope.set(promotion.scope, promotion);
    const awaiting = HELD_MEETING_PARTITIONS.filter(held => (!state || routineScopeState(held.bodyId) === state) && !identityByScope.has(held.successorScope));
    for (const promotion of await store.readPromotionIdentities(MEETINGS_RECORD_CLASS, awaiting.map(held => held.scope))) identityByScope.set(promotion.scope, promotion);
    prepared = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, preparedScope);
    const factVersions = await meetingFactVersions(state);
    const facts = { contractId: MEETING_FACTS_COUPLING, versionId: factVersions.size
      ? createHash("sha256").update(JSON.stringify([...factVersions].sort(([a], [b]) => a.localeCompare(b)))).digest("hex") : "facts:none" };
    const couplingsFor = (members: readonly MeetingPartitionContract[]): PreparedProjectionCoupling[] => members.flatMap(partition => {
      const own = identityByScope.get(partition.scope);
      const held = own ? undefined : heldMeetingPartitionFor(partition.id);
      const predecessor = held && identityByScope.get(held.scope);
      const history = meetingHistoryContract(partition);
      const historyVersion = identityByScope.get(history.scope);
      return [...(own ? [{ contractId: partition.id, versionId: own.versionId }]
        : predecessor && held ? [{ contractId: held.id, versionId: predecessor.versionId }] : []),
      ...(historyVersion ? [{ contractId: history.id, versionId: historyVersion.versionId }] : [])];
    });
    const currentCoupling = couplingsFor(partitions);
    const currentFingerprint = couplingFingerprint([...currentCoupling, facts, MEETING_LAYOUT_COUPLING]);
    if (prepared && couplingFingerprint(observedCouplings(prepared.composedFrom)) === currentFingerprint) {
      const checked = withCurrentChecks(prepared.composedFrom as readonly FreshCheckCoupling[], identityByScope);
      return { status: "CURRENT", sequence: prepared.sequence, coupledPartitions: currentCoupling.length, generatedAt: prepared.generatedAt,
        ...preparedChecks(prepared.generatedAt, checked, preparedDocumentChecks(store, preparedScope, checked, undefined, prepared.sequence)) };
    }
    const prior = prepared?.composedFrom.some(entry => entry.contractId === MEETING_LAYOUT_COUPLING.contractId && entry.versionId === MEETING_LAYOUT_COUPLING.versionId)
      ? await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, preparedScope) : null;
    const priorManifest = prior ? meetingManifest(prior.payload) : null;
    const accepted = new Map((priorManifest?.chunks ?? []).map(chunk => [chunk.key, chunk]));
    const previous = new Map([...accepted, ...(priorManifest?.heldChunks ?? []).map(({ chunk }) => [chunk.key, chunk] as const)]);
    const byPlace = new Map<string, MeetingPartitionContract[]>();
    for (const partition of partitions) {
      const key = options.aggregate ? "aggregate" : partition.ocdId?.split("#")[0] ?? partition.bodyId.split("#")[0]!;
      const members = byPlace.get(key) ?? [];
      members.push(partition); byPlace.set(key, members);
    }
    if (options.aggregate && !byPlace.size) byPlace.set("aggregate", []);
    const results = await runBoundedWorkPool([...byPlace.entries()].sort(([a], [b]) => a.localeCompare(b)), 8, async ([key, members]) => {
      const fingerprint = couplingFingerprint([...couplingsFor(members), ...members.map(member => ({
        contractId: `facts:${member.bodyId}`, versionId: factVersions.get(member.bodyId) ?? "facts:none",
      }))]);
      const former = previous.get(key);
      if (former?.fingerprint === fingerprint) return { chunk: former, unavailable: [] as SnapshotSourceReport[] };
      const aggregate = options.aggregate ? await options.aggregate() : await readMeetingsProjection({ store, now, bypassCache: true, state, partitions: members });
      if (aggregate.kind !== "PROMOTED") return { chunk: null, unavailable: members.map(partition => ({ source: partition.meetingSource,
        ok: false, error: `${partition.bodyId}: ${aggregate.detail}`, failure: "WALL" as const, fetched: 0, normalized: 0,
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        ...(partition.ocdId ? { unreachableOcdIds: [partition.ocdId] } : {}) })) };
      const composedFrom = compositionOf(aggregate.partitions);
      let value = aggregate.value;
      const missingHistory = aggregate.partitions.filter(partition => partition.historyIssue);
      if (former && missingHistory.length) {
        const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, former.scope);
        if (!row) throw new Error("PREPARED_MEETING_CHUNK_MISSING");
        const held = row.payload as MeetingsSnapshot;
        const documented = new Set(held.agendaDocuments.map(document => document.meetingId));
        const meetings = held.meetings.filter(meeting => Date.parse(meeting.startsAt) < Date.parse(now) &&
          meetingCarriesRecords(meeting, documented.has(meeting.id)) && missingHistory.some(partition =>
            meeting.bodyId === partition.bodyId || meeting.id.startsWith(`${partition.source}:`)));
        const ids = new Set(meetings.map(meeting => meeting.id));
        value = mergeMeetingHistory(value, buildMeetingHistorySnapshot({ history: null, moved: meetings,
          agendaDocuments: held.agendaDocuments.filter(document => ids.has(document.meetingId)), generatedAt: held.generatedAt }));
        for (const partition of missingHistory) {
          const contract = members.find(candidate => candidate.id === partition.contractId);
          const history = contract && former.composedFrom.find(coupling => coupling.contractId === meetingHistoryContract(contract).id);
          if (history) composedFrom.push(history);
        }
      }
      let factSha256: string;
      try { factSha256 = pdcV2CanonicalMeetingFactEvidence([value]).sha256; }
      catch { factSha256 = createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
      const hash = createHash("sha256").update(key).update(JSON.stringify(value)).update(couplingFingerprint(composedFrom)).digest("hex");
      const scope = `${preparedScope}:place:${hash}`;
      await store.writePreparedReaderProjection({ recordClass: MEETINGS_RECORD_CLASS, scope, payload: value, composedFrom, factSha256,
        generatedAt: value.generatedAt, composedAt: now, sourceThrough: aggregate.metadata.sourceThrough,
        retrievedAt: aggregate.metadata.retrievedAt, promotedThrough: aggregate.metadata.promotedAt }, null);
      const chunk: PreparedMeetingChunk = { key, scope, fingerprint, ocdId: key.startsWith("ocd-division/") ? key : null,
        bodyIds: [...new Set(value.meetings.flatMap(meeting => meeting.bodyId ? [meeting.bodyId] : []))],
        meetingIds: value.meetings.map(meeting => meeting.id), documentIds: value.agendaDocuments.map(document => document.id),
        generatedAt: value.generatedAt, counts: value.counts, sources: value.sources, composedFrom,
        sourceThrough: aggregate.metadata.sourceThrough, retrievedAt: aggregate.metadata.retrievedAt, promotedThrough: aggregate.metadata.promotedAt };
      return { chunk, unavailable: [] as SnapshotSourceReport[] };
    });
    const candidates: PreparedMeetingChunk[] = [];
    const unavailableSources: SnapshotSourceReport[] = [];
    for (const result of results) {
      if (!result.ok) throw new Error(result.error);
      if (result.value.chunk) candidates.push(result.value.chunk);
      unavailableSources.push(...result.value.unavailable);
    }
    if (!candidates.length) return { status: "NOT_COMPOSABLE", detail: "No proof-valid source/body meeting partition has been promoted.", lastValidGeneratedAt: prepared?.generatedAt ?? null };
    const collisions = chunkCollisions(candidates);
    const heldChunks = candidates.filter(chunk => collisions.has(chunk.key)).map(chunk => ({ chunk, detail: collisions.get(chunk.key)! }));
    const chunks = candidates.filter(chunk => !collisions.has(chunk.key));
    const former = heldChunks.flatMap(({ chunk }) => accepted.get(chunk.key) ?? []);
    const unsafeFormer = chunkCollisions([...chunks, ...former]);
    chunks.push(...former.filter(chunk => !unsafeFormer.has(chunk.key)));
    chunks.sort((left, right) => left.key.localeCompare(right.key));
    for (const { chunk, detail } of heldChunks) for (const partition of byPlace.get(chunk.key) ?? []) unavailableSources.push({
      source: partition.meetingSource, ok: false, error: `${partition.bodyId}: ${detail}`, failure: "WALL", fetched: 0, normalized: 0,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      ...(partition.ocdId ? { unreachableOcdIds: [partition.ocdId] } : {}),
    });
    const composedFrom = [...chunks.flatMap(chunk => chunk.composedFrom), ...heldChunks.flatMap(({ chunk }) => chunk.composedFrom
      .map(entry => ({ contractId: `${HELD_COUPLING_PREFIX}${entry.contractId}`, versionId: entry.versionId })))];
    const generatedAt = latest(chunks.map(chunk => chunk.generatedAt)) ?? now;
    const input: PreparedReaderProjectionInput = { recordClass: MEETINGS_RECORD_CLASS, scope: preparedScope,
      payload: { formatVersion: 2, chunks, heldChunks, unavailableSources } satisfies PreparedMeetingManifest,
      composedFrom: [...composedFrom, facts, MEETING_LAYOUT_COUPLING],
      factSha256: createHash("sha256").update(chunks.map(chunk => chunk.scope).join("|")).digest("hex"), generatedAt, composedAt: now,
      sourceThrough: latest(chunks.map(chunk => chunk.sourceThrough)), retrievedAt: latest(chunks.map(chunk => chunk.retrievedAt)),
      promotedThrough: latest(chunks.map(chunk => chunk.promotedThrough)) };
    const result = await store.writePreparedReaderProjection(input, prepared?.sequence ?? null);
    const checked = withCurrentChecks(input.composedFrom, identityByScope);
    return result.published ? { status: "PUBLISHED", sequence: result.sequence, coupledPartitions: composedFrom.length, generatedAt,
      ...preparedChecks(generatedAt, checked, preparedDocumentChecks(store, preparedScope, checked, input.payload as PreparedMeetingManifest)) }
      : { status: "RACED", sequence: result.sequence, coupledPartitions: composedFrom.length };
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error), lastValidGeneratedAt: prepared?.generatedAt ?? null };
  }
}

function partitionsFromCoupling(composedFrom: readonly PreparedProjectionCoupling[], partitions: readonly MeetingPartitionContract[]): MeetingPartitionReadback[] {
  const versionByContract = new Map(composedFrom.map((entry) => [entry.contractId, entry.versionId]));
  return partitions.map((partition) => {
    const versionId = versionByContract.get(partition.id);
    const held = heldMeetingPartitionFor(partition.id);
    const heldVersionId = versionId === undefined && held ? versionByContract.get(held.id) : undefined;
    const historyContract = meetingHistoryContract(partition);
    const historyVersion = versionByContract.get(historyContract.id);
    const history = historyVersion ? { history: { contractId: historyContract.id, versionId: historyVersion } } : {};
    return versionId !== undefined
      ? {
          contractId: partition.id,
          source: partition.meetingSource,
          bodyId: partition.bodyId,
          scope: partition.scope,
          kind: "PROMOTED" as const,
          versionId,
          detail: null,
          ...history,
        }
      : held && heldVersionId !== undefined
        ? {
            contractId: partition.id,
            source: partition.meetingSource,
            bodyId: partition.bodyId,
            scope: partition.scope,
            kind: "NOT_RECORDED" as const,
            versionId: null,
            detail: `the prepared reader snapshot composed the retired route's held version ${held.id}@${heldVersionId} in this partition's place`,
            heldFrom: { contractId: held.id, scope: held.scope, versionId: heldVersionId },
            ...history,
          }
        : {
            contractId: partition.id,
            source: partition.meetingSource,
            bodyId: partition.bodyId,
            scope: partition.scope,
            kind: "NOT_RECORDED" as const,
            versionId: null,
            detail: "partition is not part of the prepared reader snapshot",
            ...history,
          };
  });
}

const DEFAULT_PREPARED_STORE: object = {};
let preparedRows = new WeakMap<object, PreparedReaderProjectionRow>();

async function readPreparedRowOnceUnchanged(
  store: RoutineDataStore,
  scope: object,
  preparedScope: string,
): Promise<PreparedReaderProjectionRow | null> {
  const held = preparedRows.get(scope);
  if (held !== undefined && held.scope === preparedScope) {
    const coupling = await store.readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, preparedScope);
    if (
      coupling !== null &&
      coupling.sequence === held.sequence &&
      coupling.generatedAt === held.generatedAt &&
      couplingFingerprint(coupling.composedFrom) === couplingFingerprint(held.composedFrom)
    ) {
      return held;
    }
  }
  const row = await store.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, preparedScope);
  if (row === null) preparedRows.delete(scope);
  else preparedRows.set(scope, row);
  return row;
}

/** How long a process keeps the composition's places before it reads them again. */
export const COMPOSED_PLACES_TTL_MS = 60_000;
let composedPlaces: { readonly at: number; readonly places: ReadonlyMap<string, readonly string[]>; readonly scope: string } | null = null;

export async function readComposedSourcePlaces(options: { readonly store?: RoutineDataStore; readonly clock?: () => number; readonly state?: string } = {}):
  Promise<ReadonlyMap<string, readonly string[]> | null> {
  const preparedScope = preparedMeetingScope(options.state);
  const now = (options.clock ?? Date.now)();
  if (options.store === undefined && composedPlaces !== null && composedPlaces.scope === preparedScope && now - composedPlaces.at < COMPOSED_PLACES_TTL_MS) return composedPlaces.places;
  let coupling: Awaited<ReturnType<RoutineDataStore["readPreparedReaderProjectionCoupling"]>>;
  try {
    coupling = await (options.store ?? new PostgresRoutineDataStore()).readPreparedReaderProjectionCoupling(MEETINGS_RECORD_CLASS, preparedScope);
  } catch {
    return null;
  }
  if (coupling === null) return null;
  const held = new Set(RETIRED_MEETING_ROUTES.map((route) => meetingPartitionId(route.meetingSource, route.bodyId)));
  const places = new Map<string, string[]>();
  for (const { contractId } of coupling.composedFrom) {
    const partition = held.has(contractId) ? null : meetingPartitionOfId(contractId);
    if (partition === null) continue;
    const division = partition.bodyId.split("#")[0]!;
    const list = places.get(partition.source) ?? [];
    if (division.startsWith("ocd-division/")) list.push(division);
    places.set(partition.source, list);
  }
  if (options.store === undefined) composedPlaces = { at: now, places, scope: preparedScope };
  return places;
}

export function clearPreparedMeetingsProjectionCache(): void {
  composedPlaces = null;
  preparedRows = new WeakMap();
  servedChecks = new WeakMap();
}

/** Within this window the stated "Last checked" can only lag a newer check, never claim one that did not happen. */
export const PREPARED_CHECKS_TTL_MS = 60_000;
let servedChecks = new WeakMap<object, { readonly sequence: number; readonly scope: string; readonly readAtMs: number; readonly couplings: readonly CheckedCoupling[] }>();

async function servedPreparedChecks(
  store: RoutineDataStore,
  scope: object,
  prepared: PreparedReaderProjectionRow,
  nowMs: number,
): Promise<readonly CheckedCoupling[]> {
  const couplings = prepared.composedFrom as readonly FreshCheckCoupling[];
  const checkable = couplings.filter((coupling) => coupling.routes !== undefined);
  if (checkable.length === 0) return couplings;
  const held = servedChecks.get(scope);
  if (held !== undefined && held.sequence === prepared.sequence && held.scope === prepared.scope && nowMs >= held.readAtMs && nowMs < held.readAtMs + PREPARED_CHECKS_TTL_MS) return held.couplings;
  try {
    const identities = await store.readPromotionIdentities(
      MEETINGS_RECORD_CLASS,
      [...new Set(checkable.flatMap((coupling) => scopeOfContract(coupling.contractId) ?? []))],
    );
    const checked = withCurrentChecks(couplings, new Map(identities.map((identity) => [identity.scope, identity])));
    servedChecks.set(scope, { sequence: prepared.sequence, scope: prepared.scope, readAtMs: nowMs, couplings: checked });
    return checked;
  } catch {
    return couplings;
  }
}

export type PreparedMeetingPublicationRead = Omit<Extract<MeetingsProjectionReadResult, { kind: "PROMOTED" }>, "value"> & {
  readonly value: MeetingPublication;
  readonly checks: ReturnType<typeof meetingFreshChecks>;
};

export async function readPreparedMeetingPublication(
  options: { readonly store?: RoutineDataStore; readonly now?: string; readonly expectedSequence?: number; readonly state?: string; readonly ocdIds?: readonly string[]; readonly partitions?: readonly MeetingPartitionContract[] } = {},
): Promise<PreparedMeetingPublicationRead | null> {
  const requestedState = options.state ?? process.env.WTP_SOURCE_STATE;
  const state = requestedState ? routineScopeState(requestedState) : undefined;
  if (!options.partitions) await (await import("../doors/meeting-doors.ts")).ensureMeetingDoors(state ? { state } : {});
  const heldPartitions = (options.partitions ?? MEETING_PARTITION_CONTRACTS).filter(partition => !state || routineScopeState(partition.bodyId) === state);
  let prepared: PreparedReaderProjectionRow | null;
  let store: RoutineDataStore;
  try {
    store = options.store ?? new PostgresRoutineDataStore();
    prepared = await readPreparedRowOnceUnchanged(store, options.store ?? DEFAULT_PREPARED_STORE, preparedMeetingScope(state));
  } catch {
    prepared = null;
  }
  if (options.expectedSequence !== undefined && prepared?.sequence !== options.expectedSequence) throw new Error("PREPARED_MEETING_COPY_CHANGED_DURING_READ");
  if (!prepared) return null;
  const manifest = meetingManifest(prepared.payload);
  const wanted = options.ocdIds && new Set(options.ocdIds.map(id => id.split("#")[0]));
  const touching = wanted && factReader() ? await (await import("../civic-data/meeting-dependencies.ts")).readMeetingBodyIdsForDivisions(state ?? "US", [...wanted]) : null;
  const chunks = wanted ? manifest.chunks.filter(chunk => chunk.ocdId !== null && wanted.has(chunk.ocdId) || chunk.bodyIds.some(id => touching?.has(id))) : manifest.chunks;
  const composedFrom = wanted ? chunks.flatMap(chunk => chunk.composedFrom) : prepared.composedFrom;
  const collisions = new Map(manifest.heldChunks.flatMap(({ chunk, detail }) => chunk.composedFrom.map(entry => [entry.contractId, detail] as const)));
  const partitions = partitionsFromCoupling(composedFrom, wanted ? heldPartitions.filter(partition => partition.ocdId && wanted.has(partition.ocdId)) : heldPartitions)
    .map(partition => collisions.has(partition.contractId) ? { ...partition, kind: "STORE_UNREACHABLE" as const,
      detail: collisions.get(partition.contractId)!, versionId: null,
      ...(partition.versionId ? { heldFrom: { contractId: partition.contractId, scope: partition.scope, versionId: partition.versionId } } : {}),
    } : partition);
  const ownComposed = new Set(composedFrom.map(entry => entry.contractId));
  const allComposed = partitions.every(partition => ownComposed.has(partition.contractId));
  const nowMs = options.now !== undefined && Number.isFinite(Date.parse(options.now)) ? Date.parse(options.now) : Date.now();
  const checked = await servedPreparedChecks(store!, options.store ?? DEFAULT_PREPARED_STORE, prepared, nowMs);
  const checkedByContract = new Map(checked.map(coupling => [coupling.contractId, coupling]));
  const checks = meetingFreshChecks(checked);
  const generatedAt = laterCheck(prepared.generatedAt, checks.checkedAt) ?? prepared.generatedAt;
  const value: MeetingPublication = { generatedAt, sources: [...chunks.flatMap(chunk => chunk.sources), ...manifest.unavailableSources],
    meetingCount: chunks.reduce((sum, chunk) => sum + chunk.counts.total, 0),
    chunks: (async function* () {
      for (const chunk of chunks) {
        yield { key: chunk.key, version: chunk.scope, read: async () => {
          const row = await store!.readPreparedReaderProjection(MEETINGS_RECORD_CLASS, chunk.scope);
          if (!row) throw new Error("PREPARED_MEETING_CHUNK_MISSING");
          const documents = chunkDocumentChecks(chunk, checkedByContract, store!);
          return { snapshot: applyDocumentFreshChecks(row.payload as MeetingsSnapshot, documents ? await documents.read() : undefined) };
        } };
      }
    })() };
  return { kind: "PROMOTED", value, checks, metadata: { recordClass: MEETINGS_RECORD_CLASS, scope: MEETINGS_SCOPE, sourceId: MEETINGS_SOURCE_ID,
    version: null, versionId: null, lastKnownGoodVersionId: null, sourceThrough: prepared.sourceThrough,
    retrievedAt: laterCheck(prepared.retrievedAt, checks.checkedAt), promotedAt: prepared.promotedThrough,
    stale: allComposed ? "CURRENT" : "UNKNOWN", staleAt: null }, partitions,
    detail: `Served from the prepared reader snapshot (sequence ${prepared.sequence}, ${chunks.length} places).` };
}

export async function readPreparedMeetingsProjection(
  options: { readonly store?: RoutineDataStore; readonly now?: string; readonly expectedSequence?: number; readonly state?: string; readonly ocdIds?: readonly string[] } = {},
): Promise<MeetingsProjectionReadResult> {
  const prepared = await readPreparedMeetingPublication(options);
  if (!prepared) return readMeetingsProjection(options);
  const value: MeetingsSnapshot = { formatVersion: 1, generatedAt: prepared.value.generatedAt,
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 }, sources: prepared.value.sources, meetings: [], agendaDocuments: [] };
  for await (const chunk of prepared.value.chunks) {
    const snapshot = applyMeetingFreshChecks((await chunk.read()).snapshot, prepared.checks);
    for (const meeting of snapshot.meetings) value.meetings.push(meeting);
    for (const document of snapshot.agendaDocuments) value.agendaDocuments.push(document);
    value.counts.fresh += snapshot.counts.fresh;
    value.counts.carried += snapshot.counts.carried;
    value.counts.total += snapshot.counts.total;
    value.counts.duplicatesCollapsed! += snapshot.counts.duplicatesCollapsed ?? 0;
  }
  return { ...prepared, value };
}
