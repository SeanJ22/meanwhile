/**
 * The door registry's hand-wired meeting doors as every process reads them.
 * The standing runner reads the registry itself and publishes its open and
 * shut meeting doors as one promoted version (`meeting-doors`), the same way
 * the derived meeting wiring is published. Every other process (a partition
 * child, the Reader, Admin, the derive scripts) installs that version before
 * it builds meeting work, reads a body's doors or says which boards are live.
 * There is no other list: a process that cannot read the doors has none.
 */

import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "../civic-data/derived-authority.ts";
import { derivedRequestedUrl } from "../civic-data/derived-door.ts";
import { refreshMeetingPartitions, type MeetingPartitionRefresh } from "../civic-data/meeting-partitions.ts";
import { refreshOutcomePartitions, type OutcomePartitionRefresh } from "../civic-data/outcome-partitions.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { installDoorHosts } from "../civic-data/source-authority.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import { refreshCuratedBodyStatus } from "../registry/curated-bodies.ts";
import { activeWiring, installMeetingDoors, type BodySourceWiring } from "../registry/source-wiring.ts";
import { refreshLegistarClients } from "../sources/legistar/client-registry.ts";
import { refreshInSiteTenants } from "../sources/legistar-insite/tenant-registry.ts";
import { DOOR_STATUSES, type DoorRecord, type DoorStatus } from "./registry.ts";
import { meetingDoorHosts, wiringRowsFromDoors } from "./rows.ts";

export const MEETING_DOORS_CONTRACT_ID = "meeting-doors" as const;
export const MEETING_DOORS_SOURCE_ID = "meeting-doors" as const;
export const MEETING_DOORS_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const MEETING_DOORS_SCOPE = "US:meeting-doors" as const;
const PARSER = "meeting-doors/1" as const;

/** One published door: what its record says, without what the system keeps about its reads. */
export interface PublishedDoor {
  readonly doorId: string;
  readonly kind: string;
  readonly ocdId: string | null;
  readonly bodyIds: readonly string[];
  readonly hosts: readonly string[];
  readonly config: DoorRecord["config"];
  readonly holds: readonly string[];
  readonly checkEveryMinutes: number | null;
  readonly notes: string;
  readonly meeting: DoorRecord["meeting"];
  readonly status: DoorStatus;
}

export interface MeetingDoorsProjection {
  readonly kind: "meeting-doors";
  readonly formatVersion: 1;
  readonly doors: readonly PublishedDoor[];
}

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** A hand-wired meeting door that is in use: a meeting door of no derived family, open or shut. */
export function isPublishedMeetingDoor(door: DoorRecord): boolean {
  return door.meeting != null && (door.meeting.family ?? null) === null && door.status !== "SUSPENDED";
}

export function publishedDoor(door: DoorRecord): PublishedDoor {
  return {
    doorId: door.doorId, kind: door.kind, ocdId: door.ocdId, bodyIds: door.bodyIds, hosts: door.hosts, config: door.config,
    holds: door.holds, checkEveryMinutes: door.checkEveryMinutes, notes: door.notes, meeting: door.meeting, status: door.status,
  };
}

export function meetingDoorsProjection(doors: readonly DoorRecord[]): MeetingDoorsProjection {
  return {
    kind: "meeting-doors",
    formatVersion: 1,
    doors: doors.filter(isPublishedMeetingDoor).map(publishedDoor).sort((a, b) => (a.doorId < b.doorId ? -1 : a.doorId > b.doorId ? 1 : 0)),
  };
}

/** Why a value is not a doors version, or null. Checked on every read: a malformed version is never installed. */
export function meetingDoorsProjectionIssue(value: unknown): string | null {
  const v = value as Partial<MeetingDoorsProjection> | null;
  if (typeof v !== "object" || v === null || v.kind !== "meeting-doors" || v.formatVersion !== 1 || !Array.isArray(v.doors)) return "not a meeting-doors version";
  if (v.doors.length === 0) return "a doors version holds no door";
  const ids = new Set<string>();
  for (const door of v.doors) {
    if (!door || typeof door.doorId !== "string" || ids.has(door.doorId)) return "a door has no id, or a duplicate one";
    ids.add(door.doorId);
    if (door.meeting === null || typeof door.meeting !== "object") return `${door.doorId} is not a meeting door`;
    if (!(DOOR_STATUSES as readonly string[]).includes(door.status) || door.status === "SUSPENDED") return `${door.doorId} is not in use`;
    if (!Array.isArray(door.bodyIds) || door.bodyIds.length !== 1) return `${door.doorId} does not name one body`;
  }
  return null;
}

/** A published door as the record the door-reading code takes. */
function asRecord(door: PublishedDoor, at: string): DoorRecord {
  return { formatVersion: 1, ...door, readNow: false, lastSuccessAt: null, lastFailureAt: null, shutSince: null, origin: "DERIVED", editedAt: null, updatedAt: at };
}

/** The version, authentic only as the registry records it was computed from. */
export function meetingDoorsCandidate(rows: readonly { readonly revision: number; readonly updatedAt: string; readonly value: DoorRecord }[], attemptedAt: string): RoutineCandidate {
  const used = rows.filter((row) => isPublishedMeetingDoor(row.value));
  const readModel = meetingDoorsProjection(used.map((row) => row.value));
  const inputs: DerivedInputRef[] = used.map((row) => ({
    kind: "DOOR_RECORD" as const,
    doorId: row.value.doorId,
    revision: row.revision,
    updatedAt: row.updatedAt,
    recordSha256: sha256Hex(canonicalCivicDataJson(publishedDoor(row.value))),
  })).sort((a, b) => (a.doorId < b.doorId ? -1 : 1));
  const retrieval = derivedRetrieval(inputs);
  const succeeded = retrieval.retrievedAt !== null;
  const retrievedAt = retrieval.retrievedAt ?? attemptedAt;
  const shapeIssue = meetingDoorsProjectionIssue(readModel);
  const normalized = sha256Hex(canonicalCivicDataJson(readModel));
  const normalizedPayload = { readModel };
  return {
    id: `cv-${sha256Hex(`${MEETING_DOORS_SOURCE_ID}\u001f${MEETING_DOORS_SCOPE}\u001f${retrieval.rawHash}\u001f${retrievedAt}\u001f${attemptedAt}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: MEETING_DOORS_SOURCE_ID,
    recordClass: MEETING_DOORS_RECORD_CLASS,
    scope: MEETING_DOORS_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(MEETING_DOORS_SOURCE_ID, MEETING_DOORS_RECORD_CLASS, MEETING_DOORS_SCOPE),
    retrieval: {
      succeeded,
      requestedUrl: derivedRequestedUrl(MEETING_DOORS_SOURCE_ID, MEETING_DOORS_SCOPE),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: succeeded ? retrieval.rawHash : null,
      ...(succeeded ? {} : { failureDetail: "The door registry holds no meeting door in use, so there is nothing to publish." }),
      derived: { inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: PARSER,
      schemaVersion: "meeting-doors:1",
      normalizedHash: normalized,
      normalizedPayloadHash: sha256Hex(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: used.length,
      outputRecords: readModel.doors.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: readModel.doors.map((door) => ({
      subjectId: door.doorId,
      jurisdiction: "US",
      identifiers: { record_id: door.doorId, body_id: door.bodyIds[0] ?? "" },
      matchBasis: "EXACT_SCOPED_ID" as const,
      ambiguous: false,
    })),
    temporal: { version: MEETING_DOORS_SCOPE, expectedVersion: MEETING_DOORS_SCOPE, sourceThrough: retrievedAt, staleAtRetrieval: false },
    semantics: {
      factKind: "the door registry's hand-wired meeting doors in use",
      violations: shapeIssue === null ? [] : [`the version is not a doors version: ${shapeIssue}`],
    },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "every open or shut hand-wired meeting door in the door registry",
      returnedRecords: readModel.doors.length,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "meeting partitions, the Reader's covered bodies and agenda reads (lib/doors/meeting-doors.ts)",
      passed: shapeIssue === null,
      detail: `${readModel.doors.filter((d) => d.status === "OPEN").length} open and ${readModel.doors.filter((d) => d.status === "SHUT").length} shut door(s).`,
    }],
    normalizedPayload,
    readModel,
    excludedFacts: [],
  };
}

/** The promoted doors version. A malformed one is refused as unreadable, never installed. */
export async function readMeetingDoors(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<MeetingDoorsProjection>> {
  const read = await readPromotedCivicData<MeetingDoorsProjection>(MEETING_DOORS_RECORD_CLASS, MEETING_DOORS_SCOPE, options);
  if (read.kind !== "PROMOTED") return read;
  const issue = meetingDoorsProjectionIssue(read.value);
  return issue === null ? read
    : { kind: "STORE_UNREACHABLE", value: null, metadata: read.metadata, code: "PROMOTION_PROOF_INVALID", detail: `meeting-doors ${read.metadata.versionId}: ${issue}` };
}

export interface MeetingDoorsInstall {
  readonly rows: number;
  readonly partitions: MeetingPartitionRefresh;
  readonly outcomes: OutcomePartitionRefresh;
}

/** How long a process keeps the doors it installed before it reads the published version again. */
export const MEETING_DOORS_REFRESH_MS = 5 * 60_000;

let installed: { readonly at: number; readonly versionId: string } | null = null;
let pending: Promise<MeetingDoorsReady> | null = null;

/**
 * Puts these doors where every reader of meeting doors looks: the adapters' rows, the hosts, the partitions, the
 * tenants and the live boards. `from` names what they were read from (the registry, or a published version).
 */
export function installDoorRecords(doors: readonly DoorRecord[], from = "the door registry", at = Date.now()): MeetingDoorsInstall {
  installed = { at, versionId: from };
  const rows: BodySourceWiring[] = wiringRowsFromDoors(doors);
  installMeetingDoors(rows);
  installDoorHosts(meetingDoorHosts(doors));
  refreshLegistarClients();
  refreshInSiteTenants();
  const partitions = refreshMeetingPartitions(rows);
  refreshCuratedBodyStatus(rows);
  const outcomes = refreshOutcomePartitions(doors);
  return { rows: rows.length, partitions, outcomes };
}

export type MeetingDoorsReady =
  | { readonly ready: true; readonly versionId: string; readonly rows: number; readonly skipped: readonly string[] }
  | { readonly ready: false; readonly reason: string };

/**
 * The published doors, installed in this process. A process that has none waits for the first read. One that has
 * them answers at once, and once they are older than `MEETING_DOORS_REFRESH_MS` reads the published version again
 * behind that answer. A version that cannot be read leaves the installed doors in place until the next try.
 */
export async function ensureMeetingDoors(options: PromotedCivicDataReadOptions & { readonly clock?: () => number } = {}): Promise<MeetingDoorsReady> {
  const now = (options.clock ?? Date.now)();
  const current = (): MeetingDoorsReady => ({ ready: true, versionId: installed!.versionId, rows: activeWiring().length, skipped: [] });
  if (installed !== null && now - installed.at < MEETING_DOORS_REFRESH_MS) return current();
  pending ??= (async (): Promise<MeetingDoorsReady> => {
    try {
      const read = await readMeetingDoors({ ...options, bypassCache: true });
      if (read.kind !== "PROMOTED") throw new Error(`${read.kind}${"detail" in read && read.detail ? `: ${read.detail}` : ""}`);
      const versionId = read.metadata.versionId ?? "unnamed";
      const done = installDoorRecords(read.value.doors.map((door) => asRecord(door, read.metadata.promotedAt ?? new Date(now).toISOString())), versionId, now);
      return { ready: true, versionId, rows: done.rows, skipped: done.partitions.skipped };
    } catch (error) {
      if (installed !== null) {
        installed = { ...installed, at: now };
        return current();
      }
      return { ready: false, reason: `the published meeting doors could not be read (${error instanceof Error ? error.message : String(error)})` };
    } finally {
      pending = null;
    }
  })();
  return installed !== null ? current() : pending;
}
