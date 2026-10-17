import { carriedFromAnswer } from "./carry-forward.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import type { Meeting, NormalizeDropCounts } from "../sources/types.ts";
import type { SourceAcquisitionEvidence } from "../sources/acquisition-trace.ts";
import {
  CivicDataStoreUnavailableError,
  readPromotedCivicData,
  type CivicDataReadMetadata,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { meetingPartitionFreshnessMs } from "../civic-data/contracts.ts";
import type { HeldMeetingPartition, MeetingPartitionContract } from "../civic-data/meeting-partitions.ts";
import { DERIVED_FAMILY_SOURCE } from "../civic-data/meeting-partitions.ts";

export const MEETINGS_RECORD_CLASS = "MEETING" as const;
/** Reader composition scope; no canonical pointer is ever written at this key. */
export const MEETINGS_SCOPE = "source-wiring-partitions";
export const MEETINGS_SOURCE_ID = "meetings-public-bodies";
/** Observation-only fields excluded when research projections compare civic facts. */
export const MEETINGS_SNAPSHOT_STAMPS = {
  stampKeys: ["generatedAt", "collectedAt", "verifiedAt", "retrievedAt", "lastFreshAt"],
  ignoreTopLevel: ["counts", "sources"],
} as const;

export interface SnapshotSourceReport {
  source: string;
  ok: boolean;
  /** Why the source contributed nothing, when it didn't. */
  error: string | null;
  /** Present exactly when `ok` is false. `WALL`: the retrieval did not land and carry-forward keeps the rows. `JOB`: our
   * own code broke on a payload it held. A missing value reads as `WALL`. */
  failure?: "WALL" | "JOB";
  /** The furthest retrieval-ladder rung a walled retrieval reached; absent when unknown, never guessed. */
  walledAtRung?: number;
  /** `PRE_F22_LADDER_UNKNOWN` marks an old value whose ladder is unknown; its number is never reinterpreted. Absent
   * means `CANONICAL`. */
  rungProvenance?: "CANONICAL" | "PRE_F22_LADDER_UNKNOWN";
  fetched: number;
  normalized: number;
  drops: NormalizeDropCounts;
  /** Divisions this source could not reach while otherwise succeeding. */
  unreachableOcdIds?: string[];
  /** Rows carried from the previous snapshot because this run could not reach them; they keep their own `collectedAt`. */
  carriedForward?: number;
  /** Carried rows collapsed into another route's listing of the same sitting; `carriedForward` counts only those still held. */
  carriedCollapsed?: number;
  /** Exact acquired bodies and observed final redirects for durable promotion proof. */
  acquisitions?: readonly SourceAcquisitionEvidence[];
}

export interface SnapshotCounts {
  /** Rows this run retrieved and kept: the sum of `normalized` less `duplicatesCollapsed`. */
  fresh: number;
  /** Rows the cross-source merge collapsed as one sitting published twice. Absent means zero. */
  duplicatesCollapsed?: number;
  /** Rows carried out of the previous snapshot. Equals the marked rows. */
  carried: number;
  /** `fresh + carried`, and the length of `meetings`. */
  total: number;
}

export interface MeetingsSnapshot {
  readonly carriedSummary?: SnapshotCarriedMeta;
  formatVersion: 1;
  /** When the refresh that produced this file ran. Rendered to the reader. */
  generatedAt: string;
  /** Required: an optional reconciliation could be omitted, and the check would then pass by not running. */
  counts: SnapshotCounts;
  /** Per-source accounting — the same numbers the ingest gate prints. */
  sources: SnapshotSourceReport[];
  meetings: Meeting[];
  /** Retrieved agenda documents, append-only across refreshes. */
  agendaDocuments: AgendaDocument[];
  /** Present only on a derived meeting family's version; every meeting in it belongs to exactly one member. */
  derivedMembers?: DerivedFamilyMemberReport[];
}

/** One member of a derived meeting family, as its version accounts for it. */
export interface DerivedFamilyMemberReport {
  /** The wiring key: `${source}:${bodyId}`. */
  id: string;
  /** The adapter its sittings came from, the namespace of their ids. */
  source: string;
  bodyId: string;
  /** ACTIVE: read this pass; SUSPENDED: a review trigger fired, and nothing new is read from it. */
  status: "ACTIVE" | "SUSPENDED";
  /** FRESH: its sittings were read this version; HELD: its last verified sittings are carried, and `detail` says why. */
  outcome: "FRESH" | "HELD";
  detail?: string;
}

const DROP_KEYS: Array<keyof NormalizeDropCounts> = [
  "placeless",
  "unknownVenue",
  "unplaceableInTime",
  "notConfigured",
];

export function snapshotCounts(
  rows: readonly Meeting[],
  duplicatesCollapsed: number,
): SnapshotCounts {
  const carried = rows.filter((m) => m.carried).length;
  return {
    fresh: rows.length - carried,
    duplicatesCollapsed,
    carried,
    total: rows.length,
  };
}


export function accountCarriedCollapses(
  partitions: readonly Pick<MeetingsSnapshot, "meetings" | "sources">[],
  sources: readonly SnapshotSourceReport[],
  dropped: readonly Meeting[],
): { readonly sources: readonly SnapshotSourceReport[]; readonly freshCollapsed: number } {
  const freshCollapsed = dropped.filter((meeting) => !meeting.carried).length;
  const carriedDropped = dropped.filter((meeting) => meeting.carried);
  if (carriedDropped.length === 0) return { sources, freshCollapsed };
  const ownReports = new Map<string, readonly SnapshotSourceReport[]>();
  for (const partition of partitions) {
    for (const meeting of partition.meetings) ownReports.set(meeting.id, partition.sources);
  }
  const restated = new Map<SnapshotSourceReport, SnapshotSourceReport>();
  const current = (report: SnapshotSourceReport) => restated.get(report) ?? report;
  const answered = (report: SnapshotSourceReport) => report.ok && (report.unreachableOcdIds?.length ?? 0) === 0;
  for (const row of carriedDropped) {
    const carried = row.carried!;
    const fromAnswer = carriedFromAnswer(carried.reason);
    const report = (ownReports.get(row.id) ?? []).find((candidate) => {
      const now = current(candidate);
      return now.source === carried.source && (now.carriedForward ?? 0) > 0 && answered(now) === fromAnswer;
    });
    if (report === undefined) continue;
    const now = current(report);
    restated.set(report, { ...now, carriedForward: now.carriedForward! - 1, carriedCollapsed: (now.carriedCollapsed ?? 0) + 1 });
  }
  return { sources: sources.map((report) => restated.get(report) ?? report), freshCollapsed };
}

export function reconcileCounts(snap: MeetingsSnapshot): void {
  const counts = snap.counts;
  if (!counts || typeof counts !== "object") {
    throw new Error("snapshot must state its counts: fresh, carried, total");
  }
  for (const key of ["fresh", "carried", "total"] as const) {
    if (!Number.isInteger(counts[key])) {
      throw new Error(`snapshot count "${key}" must be stated as an integer`);
    }
  }
  if (counts.total !== snap.meetings.length) {
    throw new Error(
      `snapshot states ${counts.total} total meetings but holds ${snap.meetings.length}`,
    );
  }
  if (counts.fresh + counts.carried !== counts.total) {
    throw new Error(
      `snapshot counts do not close: ${counts.fresh} fresh + ${counts.carried} carried !== ${counts.total} total`,
    );
  }

  // `normalized` is counted before the cross-source merge and `fresh` after it; the difference must be `duplicatesCollapsed`.
  const claimed = snap.sources.reduce((n, s) => n + s.normalized, 0);
  const collapsed = counts.duplicatesCollapsed ?? 0;
  if (!Number.isInteger(collapsed) || collapsed < 0) {
    throw new Error("snapshot states a non-integer duplicatesCollapsed");
  }
  if (counts.fresh + collapsed !== claimed) {
    throw new Error(
      `snapshot states ${counts.fresh} fresh meetings plus ${collapsed} collapsed ` +
        `but sources claim ${claimed}`,
    );
  }

  const markedBySource = new Map<string, number>();
  const sourceNames = new Set(snap.sources.map((s) => s.source));
  for (const m of snap.meetings) {
    const carried = m.carried;
    if (!carried) continue;
    if (!carried.source || typeof carried.source !== "string") {
      throw new Error(`carried meeting "${m.id}" does not name the source it came from`);
    }
    if (!sourceNames.has(carried.source)) {
      throw new Error(
        `carried meeting "${m.id}" names source "${carried.source}", which this snapshot does not account for`,
      );
    }
    if (
      typeof carried.lastFreshAt !== "string" ||
      !Number.isFinite(Date.parse(carried.lastFreshAt))
    ) {
      throw new Error(
        `carried meeting "${m.id}" does not state a parseable instant at which it was last fresh`,
      );
    }
    markedBySource.set(carried.source, (markedBySource.get(carried.source) ?? 0) + 1);
  }

  const marked = [...markedBySource.values()].reduce((a, b) => a + b, 0);
  if (counts.carried !== marked) {
    throw new Error(
      `snapshot states ${counts.carried} carried meetings but ${marked} row(s) carry the mark`,
    );
  }
  for (const source of new Set(snap.sources.map(({ source }) => source))) {
    const reports = snap.sources.filter((row) => row.source === source);
    const claimedCarried = reports.reduce((sum, row) => sum + (row.carriedForward ?? 0), 0);
    const actual = markedBySource.get(source) ?? 0;
    if (claimedCarried !== actual) {
      throw new Error(
        `${source}: reports ${claimedCarried} meeting(s) carried forward but ${actual} row(s) carry its mark`,
      );
    }
    const unexplainedClaims = reports
      .filter((row) => row.ok && (row.unreachableOcdIds?.length ?? 0) === 0)
      .reduce((sum, row) => sum + (row.carriedForward ?? 0), 0);
    const unexplainedRows = snap.meetings.filter((meeting) =>
      meeting.carried?.source === source && carriedFromAnswer(meeting.carried.reason)
    ).length;
    if (unexplainedClaims !== unexplainedRows) {
      throw new Error(
        `${source}: reports ${unexplainedClaims} successful-response carry row(s) but ${unexplainedRows} row(s) name UNEXPLAINED_DISAPPEARANCE or OUTSIDE_FETCH_WINDOW`,
      );
    }
  }
}

export function validateSnapshot(
  value: unknown,
  options: { readonly allowAllSourcesFailedForDurableTransfer?: boolean } = {},
): asserts value is MeetingsSnapshot {
  const snap = value as MeetingsSnapshot;
  if (!snap || typeof snap !== "object") throw new Error("snapshot is not an object");
  if (snap.formatVersion !== 1) {
    throw new Error(`unknown snapshot formatVersion ${String(snap.formatVersion)}`);
  }
  if (!Number.isFinite(Date.parse(snap.generatedAt))) {
    throw new Error(`generatedAt is not a parseable instant: ${snap.generatedAt}`);
  }
  if (!Array.isArray(snap.sources) || snap.sources.length === 0) {
    throw new Error("snapshot must account for at least one source");
  }
  for (const s of snap.sources) {
    if (!s.source || typeof s.source !== "string") {
      throw new Error("a source report is missing its source name");
    }
    if (typeof s.ok !== "boolean") throw new Error(`${s.source}: ok must be boolean`);
    if (!s.ok && (typeof s.error !== "string" || s.error.length === 0)) {
      throw new Error(`${s.source}: a failed source must state why`);
    }
    if (!Number.isInteger(s.fetched) || !Number.isInteger(s.normalized)) {
      throw new Error(`${s.source}: fetched/normalized counts must be stated as integers`);
    }
    for (const key of DROP_KEYS) {
      if (!Number.isInteger(s.drops?.[key])) {
        throw new Error(`${s.source}: drop count "${key}" must be stated as an integer`);
      }
    }
    if (s.carriedForward !== undefined && !Number.isInteger(s.carriedForward)) {
      throw new Error(`${s.source}: carriedForward must be stated as an integer`);
    }
    if (s.carriedCollapsed !== undefined && (!Number.isInteger(s.carriedCollapsed) || s.carriedCollapsed < 1)) {
      throw new Error(`${s.source}: carriedCollapsed must be stated as a positive integer`);
    }
    if (
      s.unreachableOcdIds !== undefined &&
      (!Array.isArray(s.unreachableOcdIds) ||
        s.unreachableOcdIds.some((id) => typeof id !== "string" || !id))
    ) {
      throw new Error(`${s.source}: unreachableOcdIds must be a list of division ids`);
    }
  }
  if (!snap.sources.some((s) => s.ok)) {
    const exactCarriedLkg = options.allowAllSourcesFailedForDurableTransfer === true &&
      Array.isArray(snap.meetings) && snap.meetings.length > 0 &&
      snap.counts?.fresh === 0 &&
      snap.counts.carried === snap.counts.total &&
      snap.counts.total === snap.meetings.length;
    if (!exactCarriedLkg) {
      throw new Error(
        "every source failed — refusing any shape except an explicit nonempty all-carried durable LKG",
      );
    }
  }
  if (!Array.isArray(snap.meetings)) throw new Error("meetings must be an array");
  const sourceNames = new Set(snap.sources.map((s) => s.source));
  for (const m of snap.meetings) {
    const namespace = m.id?.split(":")[0];
    if (!namespace || !sourceNames.has(namespace)) {
      throw new Error(
        `meeting id "${m.id}" is not namespaced under any accounted source`,
      );
    }
  }
  reconcileCounts(snap);
  if (!Array.isArray(snap.agendaDocuments)) {
    throw new Error("agendaDocuments must be an array");
  }
  const meetingIds = new Set(snap.meetings.map((m) => m.id));
  for (const doc of snap.agendaDocuments) {
    if (!meetingIds.has(doc.meetingId)) {
      throw new Error(
        `agenda document ${doc.id} cites meeting ${doc.meetingId}, which is not in the snapshot`,
      );
    }
    if (doc.text?.includes("\u0000") || /^(?:PK\u0003\u0004|%PDF-)/.test(doc.text ?? "")) {
      throw new Error(
        `agenda document ${doc.id} contains binary bytes in its Reader text; retain its URL/hash and mark extraction failed`,
      );
    }
  }
  assertBodyIdentityIsPresent(snap);
  assertAttributionIsHonest(snap);
}

function assertBodyIdentityIsPresent(snap: MeetingsSnapshot): void {
  const missing = snap.meetings.filter((m) => !m.bodyId);
  if (missing.length === 0) return;
  const sample = missing
    .slice(0, 3)
    .map((m) => `${m.id} (${m.bodyName ?? "no body name"})`)
    .join(", ");
  throw new Error(
    `${missing.length} of ${snap.meetings.length} meetings carry no bodyId — for example ${sample}. ` +
      "A snapshot without body identity predates Meeting.bodyId, and every meeting in it would " +
      "take its body from its GEOGRAPHY: that is the defect that put 364 of 460 meetings on " +
      "bodies which did not hold them. Re-run `pnpm ingest composite` to regenerate it rather " +
      "than serving this file.",
  );
}

function assertAttributionIsHonest(snap: MeetingsSnapshot): void {
  for (const m of snap.meetings) {
    // Absent is not empty, and only absent is skipped: a meeting whose agenda
    // was read and named nobody legitimately carries zero rows.
    if (m.actingBodies === undefined) continue;
    if (!Array.isArray(m.actingBodies)) {
      throw new Error(`meeting ${m.id}: actingBodies must be an array when present`);
    }
    for (const row of m.actingBodies) {
      if (row.meetingId !== m.id) {
        throw new Error(
          `meeting ${m.id} carries an acting-body row citing ${row.meetingId}`,
        );
      }
      if (!row.evidence || typeof row.evidence !== "string") {
        throw new Error(
          `meeting ${m.id}: an acting-body row does not quote the heading it was read from`,
        );
      }
      if (row.attribution === "UNRESOLVED" && (row.bodyId !== null || row.ocdId !== null)) {
        throw new Error(
          `meeting ${m.id}: the unresolved segment "${row.evidence}" was attributed to ` +
            `${row.bodyId ?? row.ocdId} — an unresolved heading attributes to NOTHING, never to the host`,
        );
      }
      if (row.attribution === "RESOLVED" && !row.bodyId) {
        throw new Error(
          `meeting ${m.id}: the segment "${row.evidence}" claims RESOLVED and names no body`,
        );
      }
    }
  }
}

const validatedProjectionValues = new WeakSet<object>();

export type MeetingsProjectionReadResult =
  | {
      readonly kind: "PROMOTED";
      readonly value: MeetingsSnapshot;
      readonly metadata: CivicDataReadMetadata;
      readonly detail: string;
    }
  | Extract<CivicDataReadResult<MeetingsSnapshot>, { readonly kind: "BOOTSTRAP" | "NOT_RECORDED" | "STORE_UNREACHABLE" }>;

export async function readMeetingPartitionProjection(
  partition: MeetingPartitionContract,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<MeetingsSnapshot>> {
  const now = options.now ?? new Date().toISOString();
  const result = await readPromotedCivicData<MeetingsSnapshot>(MEETINGS_RECORD_CLASS, partition.scope, {
    ...(options.store ? { store: options.store } : {}),
    now,
    maxAgeMs: options.maxAgeMs ?? meetingPartitionFreshnessMs(now),
    bypassCache: options.bypassCache,
  });
  return validateMeetingPartitionProjection(partition, result);
}

function validateMeetingPartitionProjection(
  partition: Pick<MeetingPartitionContract | HeldMeetingPartition, "id" | "meetingSource" | "bodyId"> & {
    readonly derivedFamily?: string | null;
    readonly historyOf?: string;
  },
  result: CivicDataReadResult<MeetingsSnapshot>,
): CivicDataReadResult<MeetingsSnapshot> {
  if (result.kind !== "PROMOTED") return result;
  try {
    if (!validatedProjectionValues.has(result.value)) {
      // A durable partition may consist entirely of carried rows from one failed route; it is served, not read as blank.
      validateSnapshot(result.value, {
        allowAllSourcesFailedForDurableTransfer: true,
      });
      validatedProjectionValues.add(result.value);
    }
    if (partition.historyOf !== undefined) {
      const family = partition.meetingSource === DERIVED_FAMILY_SOURCE;
      for (const meeting of result.value.meetings) {
        if (!meeting.id || !meeting.bodyId || (!family && (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)))) {
          throw new Error(`MEETING_HISTORY_ROW_SCOPE_MISMATCH:${partition.id}:${meeting.id}`);
        }
      }
      return result;
    }
    if (partition.derivedFamily) {
      const members = result.value.derivedMembers;
      if (!Array.isArray(members) || members.length === 0) throw new Error(`MEETING_FAMILY_MEMBERS_MISSING:${partition.id}`);
      const memberSources = new Set(members.map((member) => member.source));
      if (result.value.sources.some((source) => !memberSources.has(source.source))) {
        throw new Error(`MEETING_FAMILY_SOURCE_NOT_A_MEMBER:${partition.id}`);
      }
      for (const meeting of result.value.meetings) {
        if (!members.some((member) => member.bodyId === meeting.bodyId && meeting.id.startsWith(`${member.source}:`))) {
          throw new Error(`MEETING_FAMILY_ROW_NOT_A_MEMBER:${partition.id}:${meeting.id}`);
        }
      }
      return result;
    }
    if (result.value.sources.length !== 1 || result.value.sources[0]?.source !== partition.meetingSource) {
      throw new Error(`MEETING_PARTITION_SOURCE_MISMATCH:${partition.id}`);
    }
    for (const meeting of result.value.meetings) {
      if (meeting.bodyId !== partition.bodyId || !meeting.id.startsWith(`${partition.meetingSource}:`)) {
        throw new Error(`MEETING_PARTITION_ROW_SCOPE_MISMATCH:${partition.id}:${meeting.id}`);
      }
    }
    return result;
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: result.metadata,
      code: "PROMOTION_PROOF_INVALID",
      detail: error instanceof Error ? error.message : `MEETING_PARTITION_PAYLOAD_INVALID:${partition.id}`,
    };
  }
}

/** Convert the typed state to data or a loud serving failure. */
export function requireMeetingsProjection(
  result: MeetingsProjectionReadResult,
): MeetingsSnapshot {
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") return result.value;
  if (result.kind === "STORE_UNREACHABLE") {
    throw new CivicDataStoreUnavailableError(result);
  }
  throw new Error(result.detail);
}

export interface SnapshotCarriedMeta {
  /** How many rows in the whole snapshot came from an earlier run. */
  count: number;
  /** Non-null only when every carried row shares one calendar day, and then the oldest of them. */
  lastFreshAt: string | null;
}

/** What the client is told about the snapshot behind its answer. */
export interface SnapshotClientMeta {
  generatedAt: string;
  /** Which durable/read fallback state supplied these rows. */
  dataState?: "PROMOTED" | "BOOTSTRAP";
  versionId?: string | null;
  lastKnownGoodVersionId?: string | null;
  sourceThrough?: string | null;
  retrievedAt?: string | null;
  promotedAt?: string | null;
  stale?: CivicDataReadMetadata["stale"];
  staleAt?: string | null;
  /** Present only when the snapshot actually holds carried rows. */
  carried?: SnapshotCarriedMeta;
  sources: Array<{
    source: string;
    ok: boolean;
    error: string | null;
    /** The narrow refusal, so the route attributes the gap to these bodies only. */
    unreachableOcdIds?: string[];
    /** How many of this source's rows came from the previous snapshot. */
    carriedForward?: number;
  }>;
}

export function snapshotClientMeta(
  snapshot: MeetingsSnapshot,
  read?: {
    readonly kind: "PROMOTED" | "BOOTSTRAP";
    readonly metadata: CivicDataReadMetadata;
  },
): SnapshotClientMeta {
  const stamps = snapshot.meetings.flatMap((m) =>
    m.carried ? [m.carried.lastFreshAt] : [],
  );
  const days = new Set(stamps.map((iso) => iso.slice(0, 10)));
  return {
    generatedAt: snapshot.generatedAt,
    ...(read
      ? {
          dataState: read.kind,
          versionId: read.metadata.versionId,
          lastKnownGoodVersionId: read.metadata.lastKnownGoodVersionId,
          sourceThrough: read.metadata.sourceThrough,
          retrievedAt: read.metadata.retrievedAt,
          promotedAt: read.metadata.promotedAt,
          stale: read.metadata.stale,
          staleAt: read.metadata.staleAt,
        }
      : {}),
    ...(snapshot.carriedSummary ? { carried: snapshot.carriedSummary } : stamps.length > 0
      ? {
          carried: {
            count: stamps.length,
            lastFreshAt:
              days.size === 1
                ? stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
                : null,
          },
        }
      : {}),
    sources: snapshot.sources.map(
      ({ source, ok, error, unreachableOcdIds, carriedForward }) => ({
        source,
        ok,
        error,
        ...(unreachableOcdIds?.length ? { unreachableOcdIds } : {}),
        ...(carriedForward !== undefined ? { carriedForward } : {}),
      }),
    ),
  };
}
