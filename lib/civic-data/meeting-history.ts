/** History is promoted before the partition removes the sittings, so no record is ever in neither place. */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import { derivedRetrieval, promotedInputRef, type DerivedInputRef } from "./derived-authority.ts";
import {
  MEETING_HISTORY_SOURCE_ID,
  meetingHistoryContract,
  meetingHistoryScope,
  type MeetingPartitionContract,
} from "./meeting-partitions.ts";
import { sourceProjectionEvidence, type RoutineCandidate, type RoutineRemovalEvidence } from "./types.ts";
import type { PromotionOutcome } from "./promotion.ts";
import type { CivicDataReadResult } from "./read-model.ts";
import type { RoutineDataStore } from "./store.ts";
import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { meetingCarriesRecords } from "../meetings/carries-records.ts";
import { meetingHeldWindowAt } from "../meetings/constants.ts";
import { readMeetingPartitionProjection, type MeetingsSnapshot, type SnapshotSourceReport } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import { ocdStateCode } from "../ocd/state-of.ts";

const MEETING_RECORD_CLASS = "MEETING" as const;
/** About a century: a Date can still hold `now + this`, unlike `Number.MAX_SAFE_INTEGER`. */
const HISTORY_MAX_AGE_MS = 100 * 365 * 86_400_000;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface MeetingHistoryMoveRecord {
  readonly historyScope: string;
  readonly historyVersionId: string;
}

export type MeetingHistoryMove =
  | { readonly outcome: "NONE"; readonly moved: ReadonlyMap<string, MeetingHistoryMoveRecord>; readonly detail: string }
  | { readonly outcome: "HELD"; readonly moved: ReadonlyMap<string, MeetingHistoryMoveRecord>; readonly detail: string }
  | { readonly outcome: "MOVED"; readonly moved: ReadonlyMap<string, MeetingHistoryMoveRecord>; readonly detail: string }
  | { readonly outcome: "REFUSED" | "UNAVAILABLE"; readonly moved: ReadonlyMap<string, MeetingHistoryMoveRecord>; readonly detail: string };

const NOTHING = new Map<string, MeetingHistoryMoveRecord>();

export function meetingHistoryMoveEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.WTP_MEETING_HISTORY_MOVE?.trim().toLowerCase() !== "off";
}

function sourceOf(meeting: Meeting): string {
  return meeting.carried?.source ?? meeting.id.split(":")[0] ?? "unknown";
}

export function movableToHistory(
  snapshot: MeetingsSnapshot | null,
  anchor: string,
): { readonly meetings: readonly Meeting[]; readonly agendaDocuments: readonly AgendaDocument[]; readonly lowerBound: string } | null {
  const window = meetingHeldWindowAt(anchor);
  if (snapshot === null || window === null) return null;
  const lower = Date.parse(window.lowerBound);
  const documented = new Set(snapshot.agendaDocuments.map((document) => document.meetingId));
  const meetings = snapshot.meetings.filter((meeting) => {
    const startsAt = Date.parse(meeting.startsAt);
    return Number.isFinite(startsAt) && startsAt < lower && meetingCarriesRecords(meeting, documented.has(meeting.id));
  });
  if (meetings.length === 0) return null;
  const ids = new Set(meetings.map(({ id }) => id));
  return {
    meetings,
    agendaDocuments: snapshot.agendaDocuments.filter((document) => ids.has(document.meetingId)),
    lowerBound: window.lowerBound,
  };
}

function asHistoryRow(meeting: Meeting, generatedAt: string): Meeting {
  const collected = meeting.provenance?.collectedAt;
  const lastFreshAt = meeting.carried?.lastFreshAt ??
    (Number.isFinite(Date.parse(collected ?? "")) ? collected! : generatedAt);
  return { ...meeting, carried: { source: sourceOf(meeting), lastFreshAt, reason: "OUTSIDE_FETCH_WINDOW" } };
}

function historyReports(meetings: readonly Meeting[]): SnapshotSourceReport[] {
  const counts = new Map<string, number>();
  for (const meeting of meetings) counts.set(meeting.carried!.source, (counts.get(meeting.carried!.source) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([source, carried]) => ({
    source,
    ok: true,
    error: null,
    fetched: 0,
    normalized: 0,
    carriedForward: carried,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
  }));
}

export function buildMeetingHistorySnapshot(input: {
  readonly history: MeetingsSnapshot | null;
  readonly moved: readonly Meeting[];
  readonly agendaDocuments: readonly AgendaDocument[];
  readonly generatedAt: string;
}): MeetingsSnapshot {
  const byId = new Map<string, Meeting>();
  for (const meeting of input.history?.meetings ?? []) byId.set(meeting.id, meeting);
  for (const meeting of input.moved) byId.set(meeting.id, asHistoryRow(meeting, input.generatedAt));
  const meetings = [...byId.values()].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1));
  const documents = new Map<string, AgendaDocument>();
  for (const document of [...(input.history?.agendaDocuments ?? []), ...input.agendaDocuments]) documents.set(document.id, document);
  return {
    formatVersion: 1,
    generatedAt: input.generatedAt,
    counts: { fresh: 0, carried: meetings.length, total: meetings.length, duplicatesCollapsed: 0 },
    sources: historyReports(meetings),
    meetings,
    agendaDocuments: [...documents.values()].filter((document) => byId.has(document.meetingId)),
  };
}

function historyAlreadyHolds(
  history: MeetingsSnapshot | null,
  moved: readonly Meeting[],
  documents: readonly AgendaDocument[],
  generatedAt: string,
): boolean {
  if (history === null) return false;
  const held = new Map(history.meetings.map((meeting) => [meeting.id, canonicalCivicDataJson(meeting)]));
  const heldDocuments = new Set(history.agendaDocuments.map(({ id }) => id));
  return moved.every((meeting) => held.get(meeting.id) === canonicalCivicDataJson(asHistoryRow(meeting, generatedAt))) &&
    documents.every((document) => heldDocuments.has(document.id));
}

export function meetingHistoryCandidate(
  partition: MeetingPartitionContract,
  snapshot: MeetingsSnapshot,
  inputs: readonly DerivedInputRef[],
): RoutineCandidate {
  const scope = meetingHistoryScope(partition.scope);
  const retrieval = derivedRetrieval(inputs);
  const normalized = sha256(canonicalCivicDataJson(snapshot));
  const violations: string[] = [];
  if (snapshot.meetings.some((m) => !m.id || !m.bodyId || !m.provenance?.sourceUrl)) {
    violations.push("A history sitting lacks an exact meeting id, body id, or authoritative source URL.");
  }
  if (new Set(snapshot.meetings.map((m) => m.id)).size !== snapshot.meetings.length) violations.push("History sitting identifiers are duplicated.");
  const retrievedAt = retrieval.retrievedAt ?? snapshot.generatedAt;
  const sourceThrough = snapshot.meetings
    .map((m) => m.carried?.lastFreshAt ?? m.provenance?.collectedAt ?? "")
    .filter(Boolean).sort().at(-1) ?? snapshot.generatedAt;
  return {
    id: `cv-${sha256(`${MEETING_HISTORY_SOURCE_ID}\u001f${scope}\u001f${retrieval.rawHash}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: MEETING_HISTORY_SOURCE_ID,
    recordClass: MEETING_RECORD_CLASS,
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence(MEETING_HISTORY_SOURCE_ID, MEETING_RECORD_CLASS, scope),
    retrieval: {
      succeeded: retrieval.retrievedAt !== null,
      requestedUrl: derivedRequestedUrl(MEETING_HISTORY_SOURCE_ID, scope),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: retrieval.retrievedAt !== null ? retrieval.rawHash : null,
      derived: { inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: "meetings-composite/2",
      schemaVersion: `MeetingsSnapshot:${snapshot.formatVersion}`,
      normalizedHash: normalized,
      normalizedPayloadHash: normalized,
      inputRecords: snapshot.meetings.length,
      outputRecords: snapshot.meetings.length,
      droppedRecords: 0,
      missingRequiredFields: snapshot.meetings.some((m) => !m.id || !m.bodyId) ? ["meeting.id/bodyId"] : [],
    },
    identities: snapshot.meetings.map((m) => {
      const state = ocdStateCode(m.ocdId);
      return {
        subjectId: m.id,
        jurisdiction: state ? `US-${state.toUpperCase()}` : "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION",
        identifiers: { meeting_id: m.id, body_id: m.bodyId ?? "missing", source_route: m.provenance?.sourceUrl ?? "missing" },
        matchBasis: "OFFICIAL_ID" as const,
        ambiguous: false,
      };
    }),
    temporal: { version: snapshot.generatedAt, expectedVersion: snapshot.generatedAt, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "public-body meeting and agenda publication", violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: `history of ${partition.id}: ${snapshot.meetings.length} concluded sitting(s) kept`,
      returnedRecords: snapshot.meetings.length,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/meetings/snapshot.ts", passed: snapshot.counts.total === snapshot.meetings.length, detail: `${snapshot.meetings.length} exact kept sitting rows.` },
      { consumer: "agenda and Ask", passed: snapshot.agendaDocuments.every((d) => snapshot.meetings.some((m) => m.id === d.meetingId)), detail: `${snapshot.agendaDocuments.length} agenda versions reference a kept sitting.` },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
  };
}

export async function readMeetingHistory(
  partition: MeetingPartitionContract,
  options: { readonly store: RoutineDataStore; readonly now?: string; readonly bypassCache?: boolean },
): Promise<CivicDataReadResult<MeetingsSnapshot>> {
  return readMeetingPartitionProjection(meetingHistoryContract(partition), {
    store: options.store,
    now: options.now,
    bypassCache: options.bypassCache ?? true,
    maxAgeMs: HISTORY_MAX_AGE_MS,
  });
}

export type MeetingHistoryDoor = (
  candidate: RoutineCandidate,
  now: string,
) => Promise<PromotionOutcome>;

export async function moveConcludedMeetingsToHistory(input: {
  readonly store: RoutineDataStore;
  readonly partition: MeetingPartitionContract;
  readonly previous: MeetingsSnapshot | null;
  readonly generatedAt: string;
  readonly door: MeetingHistoryDoor;
}): Promise<MeetingHistoryMove> {
  if (movableToHistory(input.previous, input.generatedAt) === null) {
    return { outcome: "NONE", moved: NOTHING, detail: "no concluded sitting with a record is older than the held window" };
  }
  const live = await readMeetingPartitionProjection(input.partition, { store: input.store, now: input.generatedAt, bypassCache: true });
  if (live.kind !== "PROMOTED") {
    return { outcome: "UNAVAILABLE", moved: NOTHING, detail: `the live partition could not be read (${live.kind})` };
  }
  const movable = movableToHistory(live.value, input.generatedAt);
  if (movable === null || live.metadata.versionId === null) {
    return { outcome: "NONE", moved: NOTHING, detail: "no concluded sitting with a record is older than the held window" };
  }
  const history = await readMeetingHistory(input.partition, { store: input.store, now: input.generatedAt });
  if (history.kind === "STORE_UNREACHABLE") {
    return { outcome: "UNAVAILABLE", moved: NOTHING, detail: `the history could not be read (${history.code})` };
  }
  const base = history.kind === "PROMOTED" ? history : null;
  const record = (versionId: string): ReadonlyMap<string, MeetingHistoryMoveRecord> => new Map(
    movable.meetings.map((meeting) => [meeting.id, { historyScope: meetingHistoryScope(input.partition.scope), historyVersionId: versionId }]),
  );
  if (base !== null && base.metadata.versionId !== null &&
      historyAlreadyHolds(base.value, movable.meetings, movable.agendaDocuments, input.generatedAt)) {
    return { outcome: "HELD", moved: record(base.metadata.versionId), detail: `${movable.meetings.length} sitting(s) already held in history ${base.metadata.versionId}` };
  }
  const partitionInput = promotedInputRef(MEETING_RECORD_CLASS, input.partition.scope, live.metadata.versionId, live.value, live.metadata.promotedAt);
  const historyInput = base === null ? null
    : promotedInputRef(MEETING_RECORD_CLASS, meetingHistoryScope(input.partition.scope), base.metadata.versionId, base.value, base.metadata.promotedAt);
  if (partitionInput === null || (base !== null && historyInput === null)) {
    return { outcome: "UNAVAILABLE", moved: NOTHING, detail: "a promoted version it must name carries no version id or promotion time" };
  }
  const snapshot = buildMeetingHistorySnapshot({
    history: base?.value ?? null,
    moved: movable.meetings,
    agendaDocuments: movable.agendaDocuments,
    generatedAt: input.generatedAt,
  });
  const candidate = meetingHistoryCandidate(input.partition, snapshot, [partitionInput, ...(historyInput ? [historyInput] : [])]);
  const outcome = await input.door(candidate, input.generatedAt);
  const versionId = outcome.promoted?.versionId ?? outcome.confirmed?.versionId ?? null;
  if (versionId === null) {
    return { outcome: "REFUSED", moved: NOTHING, detail: outcome.candidate.failureDetail ?? `the history candidate was ${outcome.candidate.state}` };
  }
  return { outcome: "MOVED", moved: record(versionId), detail: `${movable.meetings.length} sitting(s) added to history ${versionId}` };
}

export function movedToHistoryEvidence(
  meeting: Pick<Meeting, "id" | "startsAt">,
  moved: MeetingHistoryMoveRecord,
  lowerBound: string,
  parentMeetingKey?: string,
  key: string = `meeting:${meeting.id}`,
): RoutineRemovalEvidence {
  return {
    key,
    code: "MOVED_TO_HISTORY",
    historyScope: moved.historyScope,
    historyVersionId: moved.historyVersionId,
    lowerBound,
    priorStartsAt: meeting.startsAt,
    ...(parentMeetingKey ? { parentMeetingKey } : {}),
  };
}

export async function movedToHistoryAuthorityIssue(
  store: Pick<RoutineDataStore, "readPromotion">,
  candidate: RoutineCandidate,
): Promise<string | null> {
  const rows = (candidate.removalEvidence ?? []).filter((row) => row.code === "MOVED_TO_HISTORY");
  if (rows.length === 0) return null;
  const scopes = new Set(rows.map((row) => (row.code === "MOVED_TO_HISTORY" ? row.historyScope : "")));
  if (scopes.size !== 1 || ![...scopes][0] || [...scopes][0] !== meetingHistoryScope(candidate.scope)) {
    return "MOVED_TO_HISTORY_SCOPE_MISMATCH: a removal names a history scope other than this partition's own";
  }
  const pointer = await store.readPromotion<MeetingsSnapshot>(MEETING_RECORD_CLASS, [...scopes][0]!);
  if (pointer === null) return "MOVED_TO_HISTORY_NOT_HELD: this partition has no promoted history";
  const held = pointer.payload as MeetingsSnapshot | null;
  const meetings = new Map((held?.meetings ?? []).map((meeting) => [meeting.id, meeting]));
  const documentedMeetings = new Set((held?.agendaDocuments ?? []).map(({ meetingId }) => meetingId));
  for (const row of rows) {
    if (row.code !== "MOVED_TO_HISTORY") continue;
    if (row.key.startsWith("meeting:")) {
      const sitting = meetings.get(row.key.slice("meeting:".length));
      if (!sitting || sitting.startsAt !== row.priorStartsAt) {
        return `MOVED_TO_HISTORY_NOT_HELD: ${row.key} is not in the promoted history`;
      }
    } else if (row.key.startsWith("agenda-document:")) {
      if (!documentedMeetings.has(row.key.slice("agenda-document:".length))) {
        return `MOVED_TO_HISTORY_NOT_HELD: ${row.key} is not in the promoted history`;
      }
    }
  }
  return null;
}

export function mergeMeetingHistory(value: MeetingsSnapshot, history: MeetingsSnapshot | null): MeetingsSnapshot {
  if (history === null || history.meetings.length === 0) return value;
  const live = new Set(value.meetings.map(({ id }) => id));
  const added = history.meetings.filter((meeting) => !live.has(meeting.id));
  if (added.length === 0) return value;
  const ids = new Set(added.map(({ id }) => id));
  const liveDocuments = new Set(value.agendaDocuments.map(({ id }) => id));
  const documents = history.agendaDocuments.filter((document) => ids.has(document.meetingId) && !liveDocuments.has(document.id));
  const meetings = [...value.meetings, ...added];
  const carried = meetings.filter((meeting) => meeting.carried).length;
  return {
    ...value,
    counts: { ...value.counts, fresh: meetings.length - carried, carried, total: meetings.length },
    sources: [...value.sources, ...historyReports(added)],
    meetings,
    agendaDocuments: [...value.agendaDocuments, ...documents],
  };
}
