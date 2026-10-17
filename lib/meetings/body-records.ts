import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type { Meeting } from "../sources/types.ts";
import { collapseDuplicateSittings } from "../sources/composite/index.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { stampMeetingDoor } from "../civic-data/fact-door.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import type { HeldMeetingPartition, MeetingPartitionContract } from "../civic-data/meeting-partitions.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import {
  applyMeetingFreshChecks,
  applyPartitionFreshCheck,
  confirmationCheckedAt,
  laterCheck,
  meetingVersionReadsASource,
  meetingVersionRoutes,
  type FreshCheckCoupling,
} from "./fresh-checks.ts";
import { carriedFromAnswer } from "./carry-forward.ts";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "./sitting-merge.ts";
import {
  accountCarriedCollapses,
  snapshotCounts,
  validateSnapshot,
  type DerivedFamilyMemberReport,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "./snapshot.ts";

export const MEETING_BODY_FORMAT_VERSION = 1 as const;
/** The state key of a body whose divisions name no state. */
export const NATIONAL_MEETING_STATE = "US";

export const sha256OfJson = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The state, DC or territory a division (or body id) lies in, upper-cased; `US` when it names none. */
export function meetingStateOf(id: string | null | undefined): string {
  return ocdStateCode(id)?.toUpperCase() ?? statesForRegistryDivisions([id ?? ""])[0] ?? NATIONAL_MEETING_STATE;
}

export const meetingBodyRowScope = (state: string, bodyId: string): string => `US-${state}:meetings-body:${encodeURIComponent(bodyId)}`;
export const meetingIndexRowScope = (state: string): string => `US-${state}:meetings-index`;

/** A division without its body slot: what a place resolves to. */
export const divisionOf = (id: string): string => id.split("#")[0]!;

export interface MeetingBlobRef {
  readonly key: string;
  readonly sha: string;
}

export interface MeetingBodyChecks {
  readonly checkedAt: string | null;
  readonly routes: Readonly<Record<string, string>>;
}

/** The record a reader loads for one body: its served window, with its agenda text and kept history held apart. */
export interface MeetingBodyRecord {
  readonly formatVersion: typeof MEETING_BODY_FORMAT_VERSION;
  readonly bodyId: string;
  /** Meetings, sources and counts; `agendaDocuments` is empty here and held in `agenda`. */
  readonly snapshot: MeetingsSnapshot;
  readonly agenda: MeetingBlobRef | null;
  readonly history: (MeetingBlobRef & { readonly meetings: number }) | null;
}

/** The database row of one body in one state: the whole served window, agenda text included, plus where its history lives. */
export interface MeetingBodyRow {
  readonly formatVersion: typeof MEETING_BODY_FORMAT_VERSION;
  readonly bodyId: string;
  readonly snapshot: MeetingsSnapshot;
  readonly historyScopes: readonly string[];
}

export interface MeetingIndexBody {
  readonly record: MeetingBlobRef;
  /** Hash of what the record holds, so a recomposition that changed nothing writes nothing. */
  readonly content: string;
  /** The coupled partition versions this record was composed from. */
  readonly composition: string;
  /** Every coupled contract, live and history, so a changed partition finds its bodies. */
  readonly contracts: readonly string[];
  readonly divisions: readonly string[];
  readonly meetings: number;
  readonly generatedAt: string;
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
  readonly checks: MeetingBodyChecks;
}

/** One state's bodies and which divisions each serves. */
export interface MeetingStateIndex {
  readonly formatVersion: typeof MEETING_BODY_FORMAT_VERSION;
  readonly state: string;
  /** The registry the places were derived from. */
  readonly registryVersion: string | null;
  readonly places: Readonly<Record<string, readonly string[]>>;
  readonly bodies: Readonly<Record<string, MeetingIndexBody>>;
}

export function emptyMeetingStateIndex(state: string, registryVersion: string | null): MeetingStateIndex {
  return { formatVersion: MEETING_BODY_FORMAT_VERSION, state, registryVersion, places: {}, bodies: {} };
}

export function encodeMeetingBlob(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

export function decodeMeetingBlob<T>(bytes: Uint8Array, sha: string): T {
  const value = JSON.parse(gunzipSync(bytes).toString("utf8")) as T;
  if (sha256OfJson(value) !== sha) throw new Error("MEETING_BLOB_HASH_MISMATCH");
  return value;
}

export function placesOf(bodies: Readonly<Record<string, Pick<MeetingIndexBody, "divisions">>>): Record<string, string[]> {
  const places = new Map<string, string[]>();
  for (const [id, body] of Object.entries(bodies).sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const division of body.divisions) places.set(division, [...(places.get(division) ?? []), id]);
  }
  return Object.fromEntries([...places].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function meetingCompositionOf(couplings: readonly Pick<FreshCheckCoupling, "contractId" | "versionId">[]): string {
  return createHash("sha256").update(couplings.map(({ contractId, versionId }) => `${contractId}=${versionId}`).sort().join("|")).digest("hex");
}

type PromotedRead = Extract<CivicDataReadResult<MeetingsSnapshot>, { kind: "PROMOTED" }>;

export interface BodyPartitionRead {
  readonly partition: MeetingPartitionContract;
  /** Set when the successor has no pointer of its own and its retired predecessor's version stands in. */
  readonly held: HeldMeetingPartition | null;
  readonly read: CivicDataReadResult<MeetingsSnapshot>;
}

export interface BodyHistoryRead {
  readonly contractId: string;
  readonly scope: string;
  readonly versionId: string | null;
  readonly value: MeetingsSnapshot | null;
}

export interface ComposedMeetingBody {
  readonly snapshot: MeetingsSnapshot;
  readonly couplings: readonly FreshCheckCoupling[];
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
}

const newest = (values: readonly (string | null)[]): string | null =>
  values.filter((value): value is string => value !== null).sort().at(-1) ?? null;

/**
 * A family's members each name the body and adapter they read. The body's reports state each member's outcome over its own rows:
 * fresh rows and rows carried after the source answered under one report, rows carried because it could not be reached under another.
 */
function memberReports(members: readonly DerivedFamilyMemberReport[], rows: readonly Meeting[]): SnapshotSourceReport[] {
  const zero = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
  return members.flatMap((member) => {
    const own = rows.filter((row) => (row.carried?.source ?? row.id.split(":")[0]) === member.source);
    const fresh = own.filter((row) => !row.carried);
    const answered = own.filter((row) => row.carried && carriedFromAnswer(row.carried.reason)).length;
    const walled = own.filter((row) => row.carried && !carriedFromAnswer(row.carried.reason)).length;
    const reached = member.outcome === "FRESH";
    return [
      ...(reached || fresh.length > 0 || answered > 0 ? [{
        source: member.source, ok: true, error: null, fetched: fresh.length, normalized: fresh.length, drops: zero,
        ...(answered > 0 ? { carriedForward: answered } : {}),
      }] : []),
      ...(!reached || walled > 0 ? [{
        source: member.source, ok: false, error: member.detail ?? `${member.bodyId}: the last verified sittings are held`, failure: "WALL" as const,
        fetched: 0, normalized: 0, drops: zero, ...(walled > 0 ? { carriedForward: walled } : {}),
      }] : []),
    ];
  });
}

function unreachableReport(partition: MeetingPartitionContract, detail: string): SnapshotSourceReport {
  return {
    source: partition.meetingSource, ok: false, error: `${partition.bodyId}: ${detail}`, failure: "WALL", fetched: 0, normalized: 0,
    drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    ...(partition.ocdId ? { unreachableOcdIds: [partition.ocdId] } : {}),
  };
}

/**
 * One body's served window from the partitions that hold its sittings. Null when none of them has a promoted version;
 * throws when what they hold fails the snapshot's own proof, so the body's previous record keeps serving.
 */
export function composeMeetingBody(input: {
  readonly bodyId: string;
  readonly divisions: readonly string[];
  readonly reads: readonly BodyPartitionRead[];
  readonly histories: readonly BodyHistoryRead[];
}): ComposedMeetingBody | null {
  const promoted = input.reads.flatMap(({ partition, held, read }) => read.kind === "PROMOTED" ? [{ partition, held, read: read as PromotedRead }] : []);
  if (promoted.length === 0) return null;

  const owned = promoted.map(({ partition, held, read }) => {
    const family = partition.derivedFamily !== null;
    const meetings = family ? read.value.meetings.filter((meeting) => meeting.bodyId === input.bodyId) : read.value.meetings;
    const ids = new Set(meetings.map(({ id }) => id));
    const readsASource = meetingVersionReadsASource(read.value.sources);
    const checkedAt = confirmationCheckedAt(read.projection?.latestConfirmation, read.metadata.versionId, readsASource);
    const routes = meetingVersionRoutes({ meetings, sources: read.value.sources });
    const own = { ...read.value, meetings, agendaDocuments: read.value.agendaDocuments.filter((document) => ids.has(document.meetingId)),
      ...(family ? { counts: snapshotCounts(meetings, 0) } : {}) };
    const stamped = stampMeetingDoor(partition, applyPartitionFreshCheck(own, checkedAt));
    return { partition, held, read, family, value: stamped, routes, checkedAt };
  });

  const meetingOwners = new Map<string, number>();
  const documentOwners = new Map<string, number>();
  for (const { value } of owned) {
    for (const meeting of value.meetings) meetingOwners.set(meeting.id, (meetingOwners.get(meeting.id) ?? 0) + 1);
    for (const document of value.agendaDocuments) documentOwners.set(document.id, (documentOwners.get(document.id) ?? 0) + 1);
  }
  for (const [id, owners] of meetingOwners) if (owners > 1) throw new Error(`MEETING_PARTITION_ID_COLLISION:${id}`);
  for (const [id, owners] of documentOwners) if (owners > 1) throw new Error(`MEETING_PARTITION_DOCUMENT_COLLISION:${id}`);

  const divisions = new Set(input.divisions.map(divisionOf));
  const meetings = owned.flatMap(({ value }) => value.meetings);
  const agendaDocuments = owned.flatMap(({ value }) => value.agendaDocuments);
  const attribute = (report: SnapshotSourceReport): SnapshotSourceReport => !report.ok && report.unreachableOcdIds === undefined && input.divisions.length > 0
    ? { ...report, unreachableOcdIds: [...new Set(input.divisions.map(divisionOf))] } : report;
  const ownReports = owned.map(({ family, value, read }): SnapshotSourceReport[] =>
    (family ? memberReports((read.value.derivedMembers ?? []).filter((member) => member.bodyId === input.bodyId), value.meetings) : [...value.sources]).map(attribute));
  const sources = ownReports.flat();
  for (const { partition, read } of input.reads.filter((row) => row.read.kind !== "PROMOTED")) {
    if (partition.derivedFamily === null) sources.push(attribute(unreachableReport(partition, "detail" in read ? read.detail : "partition unavailable")));
  }
  if (sources.length === 0 && meetings.length === 0) return null;

  const exact = collapseDuplicateSittings(meetings, mergeDuplicateSittingFields);
  const merged = mergeReaderSittings(exact.rows);
  const dropped = [...exact.dropped, ...merged.dropped];
  const accounted = accountCarriedCollapses(owned.map(({ value }, index) => ({ meetings: value.meetings, sources: ownReports[index]! })), sources, dropped);
  const retained = new Set(merged.rows.map((meeting) => meeting.id));
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: newest(owned.map(({ value }) => value.generatedAt))!,
    counts: snapshotCounts(merged.rows, accounted.freshCollapsed + owned.reduce((sum, { value }) => sum + (value.counts.duplicatesCollapsed ?? 0), 0)),
    sources: [...accounted.sources],
    meetings: merged.rows,
    agendaDocuments: agendaDocuments
      .map((document) => ({ ...document, meetingId: merged.aliases.get(document.meetingId) ?? document.meetingId }))
      .filter((document) => retained.has(document.meetingId)),
  };
  if (snapshot.meetings.length > 0) validateSnapshot(snapshot, { allowAllSourcesFailedForDurableTransfer: true });

  const couplings: FreshCheckCoupling[] = owned.map(({ partition, held, read, routes, checkedAt }) => ({
    contractId: held ? held.id : partition.id,
    versionId: read.metadata.versionId!,
    ...(routes === null ? {} : { routes, checkedAt }),
  }));
  for (const history of input.histories) if (history.versionId !== null) couplings.push({ contractId: history.contractId, versionId: history.versionId });
  return {
    snapshot,
    couplings,
    sourceThrough: newest(owned.map(({ read }) => read.metadata.sourceThrough)),
    retrievedAt: newest(owned.map(({ read }) => read.metadata.retrievedAt)),
    promotedThrough: newest(owned.map(({ read }) => read.metadata.promotedAt)),
  };
}

/** A body's kept past sittings, from every history partition that holds some of them. */
export function composeMeetingBodyHistory(bodyId: string, histories: readonly BodyHistoryRead[], generatedAt: string): MeetingsSnapshot | null {
  const meetings = new Map<string, Meeting>();
  const documents = new Map<string, AgendaDocument>();
  for (const { value } of histories) {
    for (const meeting of value?.meetings ?? []) if (meeting.bodyId === bodyId) meetings.set(meeting.id, meeting);
  }
  for (const { value } of histories) for (const document of value?.agendaDocuments ?? []) if (meetings.has(document.meetingId)) documents.set(document.id, document);
  if (meetings.size === 0) return null;
  const rows = [...meetings.values()].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.carried?.source ?? row.id.split(":")[0]!, (counts.get(row.carried?.source ?? row.id.split(":")[0]!) ?? 0) + 1);
  return {
    formatVersion: 1,
    generatedAt,
    counts: { fresh: 0, carried: rows.length, total: rows.length, duplicatesCollapsed: 0 },
    sources: [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([source, carried]) => ({
      source, ok: true, error: null, fetched: 0, normalized: 0, carriedForward: carried,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
    })),
    meetings: rows,
    agendaDocuments: [...documents.values()],
  };
}

/** What a reader at a place holds: its bodies' served windows, with each body's own newest checks applied. */
export function mergeMeetingBodies(parts: readonly {
  readonly entry: MeetingIndexBody;
  readonly record: MeetingBodyRecord;
  readonly agenda: readonly AgendaDocument[];
  readonly history: MeetingsSnapshot | null;
}[]): { readonly snapshot: MeetingsSnapshot; readonly sourceThrough: string | null; readonly retrievedAt: string | null; readonly promotedThrough: string | null } {
  const bodies = parts.map(({ entry, record, agenda, history }) => {
    const served = applyMeetingFreshChecks({ ...record.snapshot, agendaDocuments: [...agenda] }, entry.checks);
    if (history === null) return served;
    const held = new Set(served.meetings.map(({ id }) => id));
    const past = history.meetings.filter((meeting) => !held.has(meeting.id));
    // A kept sitting that the live listing also states is one sitting, exactly as when they were held together.
    const exact = collapseDuplicateSittings([...served.meetings, ...past], mergeDuplicateSittingFields);
    const joined = mergeReaderSittings(exact.rows);
    const pastIds = new Set(past.map(({ id }) => id));
    return { ...served, meetings: joined.rows, sources: [...served.sources, ...history.sources],
      agendaDocuments: [...served.agendaDocuments, ...history.agendaDocuments.filter((document) => pastIds.has(document.meetingId))]
        .map((document) => ({ ...document, meetingId: joined.aliases.get(document.meetingId) ?? document.meetingId })) };
  });
  const meetings = bodies.flatMap((body) => body.meetings).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1));
  const generatedAt = bodies.reduce<string | null>((latest, body, index) => laterCheck(latest, laterCheck(body.generatedAt, parts[index]!.entry.checks.checkedAt)), null);
  return {
    snapshot: {
      formatVersion: 1,
      generatedAt: generatedAt ?? new Date(0).toISOString(),
      counts: snapshotCounts(meetings, 0),
      sources: bodies.flatMap((body) => body.sources),
      meetings,
      agendaDocuments: bodies.flatMap((body) => body.agendaDocuments),
    },
    sourceThrough: newest(parts.map(({ entry }) => entry.sourceThrough)),
    retrievedAt: newest(parts.map(({ entry }) => laterCheck(entry.retrievedAt, entry.checks.checkedAt))),
    promotedThrough: newest(parts.map(({ entry }) => entry.promotedThrough)),
  };
}
