/**
 * **MEETING HISTORY ALREADY DELETED IS RESTORED, ONCE** (DB-55; rulings §6: restore the result, not only stop the loss).
 *
 * Before DB-01, every pass removed a prior sitting that began outside the shown window, under
 * `OUTSIDE_REGISTERED_SERVING_WINDOW`, so a concluded meeting and its agenda or minutes disappeared from its partition.
 * Each such sitting is still in an earlier promoted version of the same partition: the pointer-move chain keeps every
 * version it ever promoted, with the publisher's own evidence and read dates on each row.
 *
 * This walks that chain (the same anchored, individually proven reader the federal vote history uses) and gathers every
 * concluded sitting that carried an agenda, minutes, an outcome or a vote and is in neither the live partition nor its
 * durable history. The caller adds them back to the partition's own candidate, carried under `OUTSIDE_FETCH_WINDOW`
 * with the instant each was last really read; DB-06 then moves the older ones into history. Nothing here writes.
 *
 * It restores only what the window removed. A sitting a fresh occurrence record or a re-issued listing replaced, and a
 * series record its occurrences replaced, are other removals and are not brought back beside their successors.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

/**
 * The restore runs by itself: nobody has to set a switch on the runner. Each partition walks its promoted chain until
 * one walk finishes with nothing left to add, then leaves a marker and does no more chain reads.
 * `WTP_MEETING_HISTORY_RESTORE=off` stops it. (It was an opt-in switch first; the switch was never set and the
 * deleted meetings stayed deleted.)
 */
export function meetingHistoryRestoreEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.WTP_MEETING_HISTORY_RESTORE?.trim().toLowerCase() !== "off";
}

/** Where the "this partition is fully restored" markers live. A lost marker only costs one more idempotent walk. */
function restoreMarkerFile(scope: string, env: Readonly<Record<string, string | undefined>>): string {
  const dir = env.WTP_RESTORE_STATE_DIR?.trim() || join(tmpdir(), "meanwhile-history-restore");
  return join(dir, `${createHash("sha256").update(scope).digest("hex").slice(0, 24)}.done`);
}

export function meetingHistoryRestoreFinished(scope: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  try { return existsSync(restoreMarkerFile(scope, env)); } catch { return false; }
}

/** Called after a walk of the whole chain that found nothing to add. */
export function markMeetingHistoryRestoreFinished(scope: string, at: string, env: Readonly<Record<string, string | undefined>> = process.env): void {
  try {
    const file = restoreMarkerFile(scope, env);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${scope}\n${at}\n`);
  } catch {
    // No marker only means the next pass walks the chain again.
  }
}

export interface RestoredMeetingHistory {
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: readonly AgendaDocument[];
  readonly versionsRead: number;
  /** True when the whole chain was read; false when the cap ended the walk (the next pass continues it). */
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

/** A row another row replaced is a different removal; it is not restored beside its successor. */
function replacedBy(row: Meeting, others: readonly Meeting[]): boolean {
  return others.some((other) =>
    other.id !== row.id && other.bodyId === row.bodyId &&
    (supersedesSeriesRecord(facts(row), facts(other)) || reissuesSitting(facts(row), facts(other))));
}

/**
 * The restorable sittings of a partition: concluded, carrying a record, older than the held window, in an earlier
 * promoted version, and in neither the live partition nor its history. The newest copy of a sitting wins.
 */
export async function restoreRemovedMeetingHistory(input: {
  readonly store: RoutineDataStore;
  readonly partition: MeetingPartitionContract;
  readonly live: MeetingsSnapshot | null;
  readonly history: MeetingsSnapshot | null;
  readonly generatedAt: string;
  /** Predecessor versions read per call; a longer chain is finished by the next pass. */
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

/** The partition's previous snapshot with the restored sittings in it as carried rows, so its next candidate keeps them. */
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
