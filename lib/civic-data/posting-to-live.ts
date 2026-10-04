/**
 * **TIME FROM POSTING TO LIVE IS MEASURED** (DB-27; rulings §4's one-hour target inside the 7-day window).
 *
 * For each new or changed meeting, agenda link, status and outcome a promoted version carries, four times are kept
 * apart:
 *
 * - `postedAt`: when the publisher says it posted it (`Meeting.postedAt`: Legistar's agenda or minutes stamp, iCal's
 *   `LAST-MODIFIED`), only when that stamp moved with this change;
 * - `firstSeenAt`: when we first saw it, the version's own retrieval time (the change set promotion already computes
 *   says which records that version added or changed);
 * - `lastUnchangedAt`: the last check that found it unchanged (the newest confirmation of the version);
 * - `liveAt`: when it went live, the reader readback PASS for that version, which comes after the edge publish and
 *   purge.
 *
 * The clock runs from `postedAt`, or from `firstSeenAt` when the publisher states no posting time, and `basis` says
 * which, so a figure measured from first seen is never labelled posted-to-live. Nothing here is a gate or a score: it
 * reads what promotion already recorded.
 */
import { parseReaderProjectionReadback } from "./reader-readback.ts";
import { latestUnchangedConfirmation } from "./unchanged-confirmation.ts";
import type { CandidateEvent, RoutineChangeSet, RoutineRecordClass } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";

export type PostedChangeKind = "MEETING_NEW" | "MEETING_CHANGED" | "AGENDA_LINK" | "STATUS" | "OUTCOME";

export interface PostingToLiveRow {
  readonly recordKey: string;
  readonly kind: PostedChangeKind;
  readonly versionId: string;
  /** The publisher's own posting stamp, when it states one that moved with this change. */
  readonly postedAt: string | null;
  readonly firstSeenAt: string;
  readonly lastUnchangedAt: string | null;
  readonly liveAt: string | null;
  /** What the clock runs from: the publisher's stamp, or when we first saw it. */
  readonly basis: "POSTED" | "FIRST_SEEN";
  /** Minutes from the basis to live; null until the version has a readback PASS. */
  readonly minutesToLive: number | null;
  /** The sitting's start, when the record is a meeting, and whether it began inside 7 days of the first sight (the target's window). */
  readonly startsAt: string | null;
  readonly insideSevenDayWindow: boolean | null;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;
const instant = (value: unknown): string | null => {
  const raw = text(value);
  return raw !== null && Number.isFinite(Date.parse(raw)) ? raw : null;
};
const minutesBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

/**
 * The measured changes of one promoted version. Pure. `liveAt` is the version's readback PASS time (null until it has
 * one) and `lastUnchangedAt` its newest confirmation; the change set names what the version added or changed.
 */
export function postingToLiveFromVersion(input: {
  readonly recordClass?: RoutineRecordClass;
  readonly versionId: string;
  readonly firstSeenAt: string;
  readonly changeSet: Pick<RoutineChangeSet, "added" | "changed">;
  readonly liveAt: string | null;
  readonly lastUnchangedAt: string | null;
}): PostingToLiveRow[] {
  const rows: PostingToLiveRow[] = [];
  const emit = (recordKey: string, kind: PostedChangeKind, before: Record<string, unknown> | null, after: Record<string, unknown>) => {
    const posted = instant(after.postedAt);
    const moved = posted !== null && (before === null || instant(before.postedAt) !== posted);
    const postedAt = moved ? posted : null;
    const basis = postedAt !== null ? "POSTED" as const : "FIRST_SEEN" as const;
    const startsAt = instant(after.startsAt);
    rows.push({
      recordKey,
      kind,
      versionId: input.versionId,
      postedAt,
      firstSeenAt: input.firstSeenAt,
      lastUnchangedAt: input.lastUnchangedAt,
      liveAt: input.liveAt,
      basis,
      minutesToLive: input.liveAt === null ? null : minutesBetween(postedAt ?? input.firstSeenAt, input.liveAt),
      startsAt: kind === "OUTCOME" ? null : startsAt,
      insideSevenDayWindow: startsAt === null || kind === "OUTCOME"
        ? null
        : Math.abs(Date.parse(startsAt) - Date.parse(input.firstSeenAt)) <= 7 * 86_400_000,
    });
  };
  for (const delta of [...input.changeSet.added, ...input.changeSet.changed]) {
    const after = object(delta.after);
    if (after === null) continue;
    // An outcome (a decision or a roll call recorded for a sitting) is measured from when we first saw it: the
    // publisher's minutes stamp dates the document, not the decision.
    if (input.recordClass === "MEETING_OUTCOME") {
      if (delta.key.startsWith("outcome:") || delta.key.startsWith("roll-call:")) emit(delta.key, "OUTCOME", null, { startsAt: after.startsAt ?? null });
      continue;
    }
    if (!delta.key.startsWith("meeting:")) continue;
    const before = object(delta.before);
    if (before === null) {
      emit(delta.key, "MEETING_NEW", null, after);
      if (text(after.agendaUrl) !== null) emit(delta.key, "AGENDA_LINK", null, after);
      continue;
    }
    let named = false;
    if (text(before.agendaUrl) === null && text(after.agendaUrl) !== null) { emit(delta.key, "AGENDA_LINK", before, after); named = true; }
    if (text(before.status) !== text(after.status)) { emit(delta.key, "STATUS", before, after); named = true; }
    if (!named) emit(delta.key, "MEETING_CHANGED", before, after);
  }
  return rows;
}

/** The readback PASS time of a version among its candidate events, or null. */
export function readbackPassAt(events: readonly Pick<CandidateEvent, "detail">[], versionId: string): string | null {
  const times = events
    .map((event) => parseReaderProjectionReadback(event.detail))
    .filter((receipt) => receipt !== null && receipt.status === "PASS" && receipt.versionId === versionId)
    .map((receipt) => receipt!.observedAt)
    .sort();
  return times[0] ?? null;
}

/**
 * One promoted version's posting-to-live rows, read from the store: its candidate (retrieval time and change set) and
 * its events (readback PASS, newest unchanged confirmation). Null when the version is not a stored candidate.
 */
export async function readPostingToLive(
  store: Pick<RoutineDataStore, "readCandidate" | "events">,
  versionId: string,
): Promise<readonly PostingToLiveRow[] | null> {
  const record = await store.readCandidate(versionId);
  if (record === null || record.state !== "PROMOTED") return null;
  const changeSet = record.candidate.changeSet;
  if (changeSet === undefined) return [];
  const events = await store.events(versionId);
  return postingToLiveFromVersion({
    recordClass: record.candidate.recordClass,
    versionId,
    firstSeenAt: record.candidate.retrieval.retrievedAt,
    changeSet,
    liveAt: readbackPassAt(events, versionId),
    lastUnchangedAt: latestUnchangedConfirmation(events, versionId)?.observedAt ?? null,
  });
}

/** The record classes this measure reads: meetings (with their agenda links and statuses) and the outcomes recorded for them. */
export function postingToLiveClass(recordClass: RoutineRecordClass): boolean {
  return recordClass === "MEETING" || recordClass === "MEETING_OUTCOME";
}

