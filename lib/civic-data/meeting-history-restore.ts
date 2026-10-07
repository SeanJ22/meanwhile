import { readPromotedCivicData, readPromotedCivicDataPredecessors, type CivicDataReadResult, type ProvenCivicDataHistory } from "./read-model.ts";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import type { RoutineDataStore } from "./store.ts";
import type { AgendaDocument } from "../meetings/agenda-documents.ts";
import { meetingCarriesRecords } from "../meetings/carries-records.ts";
import { meetingHeldWindowAt } from "../meetings/constants.ts";
import { meetingPartitionFreshnessMs } from "./contracts.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { reissuesSitting, supersedesSeriesRecord, type ListedSittingFacts } from "../sources/event-identity.ts";
import type { Meeting } from "../sources/types.ts";

export function meetingHistoryRestoreEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.WTP_MEETING_HISTORY_RESTORE?.trim().toLowerCase() === "on";
}

export interface RestoredMeetingHistory {
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: readonly AgendaDocument[];
  readonly versionsRead: number;
  /** False when the cap ended the walk; the next pass continues it. */
  readonly complete: boolean;
  readonly detail: string;
}

const EMPTY: RestoredMeetingHistory = { meetings: [], agendaDocuments: [], versionsRead: 0, complete: true, detail: "nothing to restore" };

const facts = (row: Meeting): ListedSittingFacts => ({
  id: row.id,
  bodyId: row.bodyId ?? null,
  bodyName: row.bodyName ?? null,
  title: row.title ?? null,
  startsAt: row.startsAt,
  startPrecision: (row as { startPrecision?: string }).startPrecision ?? null,
  timeZone: row.timeZone ?? null,
});

function replacedBy(row: Meeting, others: readonly Meeting[]): boolean {
  return others.some((other) =>
    other.id !== row.id && other.bodyId === row.bodyId &&
    (supersedesSeriesRecord(facts(row), facts(other)) || reissuesSitting(facts(row), facts(other))));
}

export async function restoreRemovedMeetingHistory(input: {
  readonly store: RoutineDataStore;
  readonly partition: MeetingPartitionContract;
  readonly live: MeetingsSnapshot | null;
  readonly history: MeetingsSnapshot | null;
  readonly generatedAt: string;
  readonly maxVersions?: number;
}): Promise<RestoredMeetingHistory> {
  const window = meetingHeldWindowAt(input.generatedAt);
  const live = input.live;
  if (window === null || live === null) return EMPTY;
  const lower = Date.parse(window.lowerBound);
  const have = new Set([...live.meetings, ...(input.history?.meetings ?? [])].map(({ id }) => id));
  const current: CivicDataReadResult<MeetingsSnapshot> = await readPromotedCivicData<MeetingsSnapshot>("MEETING", input.partition.scope, {
    store: input.store,
    now: input.generatedAt,
    maxAgeMs: meetingPartitionFreshnessMs(input.generatedAt),
    bypassCache: true,
  });
  if (current.kind !== "PROMOTED") return { ...EMPTY, detail: `the live partition is ${current.kind}; nothing restored` };

  const found = new Map<string, Meeting>();
  const documents = new Map<string, AgendaDocument[]>();
  const cap = Math.max(1, input.maxVersions ?? 400);
  let versionsRead = 0;
  let cursor: string | null = null;
  let complete = false;
  let issue: string | null = null;
  while (versionsRead < cap) {
    const page: ProvenCivicDataHistory<MeetingsSnapshot> = await readPromotedCivicDataPredecessors<MeetingsSnapshot>("MEETING", input.partition.scope, current, {
      cursor, pageSize: 16, store: input.store, bypassCache: true, now: input.generatedAt,
    });
    if (page.issue !== null) { issue = page.issue; break; }
    for (const version of page.versions) {
      versionsRead += 1;
      const snapshot = version.value;
      if (!Array.isArray(snapshot?.meetings)) continue;
      const documented = new Set((snapshot.agendaDocuments ?? []).map(({ meetingId }) => meetingId));
      for (const meeting of snapshot.meetings) {
        const startsAt = Date.parse(meeting.startsAt);
        if (have.has(meeting.id) || found.has(meeting.id) || !Number.isFinite(startsAt) || !(startsAt < lower)) continue;
        if (!meetingCarriesRecords(meeting, documented.has(meeting.id))) continue;
        found.set(meeting.id, meeting);
        documents.set(meeting.id, (snapshot.agendaDocuments ?? []).filter(({ meetingId }) => meetingId === meeting.id));
      }
    }
    if (page.complete) { complete = true; break; }
    if (page.nextVersionId === null) break;
    cursor = page.nextVersionId;
  }
  const candidates = [...found.values()];
  const restored = candidates.filter((row) => !replacedBy(row, [...live.meetings, ...candidates]));
  const kept = new Set(restored.map(({ id }) => id));
  return {
    meetings: restored,
    agendaDocuments: [...documents.entries()].filter(([id]) => kept.has(id)).flatMap(([, rows]) => rows),
    versionsRead,
    complete,
    detail: `${restored.length} sitting(s) restorable from ${versionsRead} earlier version(s)` +
      `${candidates.length > restored.length ? `; ${candidates.length - restored.length} replaced by a successor and left out` : ""}` +
      `${issue ? `; the walk stopped: ${issue}` : complete ? "" : "; more of the chain remains for the next pass"}`,
  };
}

export function withRestoredHistory(previous: MeetingsSnapshot, restored: RestoredMeetingHistory, generatedAt: string): MeetingsSnapshot {
  if (restored.meetings.length === 0) return previous;
  const rows = restored.meetings.map((meeting): Meeting => {
    const collected = meeting.provenance?.collectedAt;
    const lastFreshAt = meeting.carried?.lastFreshAt ??
      (Number.isFinite(Date.parse(collected ?? "")) ? collected! : generatedAt);
    return { ...meeting, carried: { source: meeting.carried?.source ?? meeting.id.split(":")[0] ?? "unknown", lastFreshAt, reason: "OUTSIDE_FETCH_WINDOW" } };
  });
  const have = new Set(previous.agendaDocuments.map(({ id }) => id));
  return {
    ...previous,
    meetings: [...previous.meetings, ...rows],
    agendaDocuments: [...previous.agendaDocuments, ...restored.agendaDocuments.filter(({ id }) => !have.has(id))],
  };
}
