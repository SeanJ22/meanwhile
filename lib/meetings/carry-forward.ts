import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "./constants.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting, PartialScopeFailure } from "../sources/types.ts";

/**
 * A carried row retained out of a response that ANSWERED: either its listing
 * was absent from the answer, or it lies outside the dates the read fetched
 * (`OUTSIDE_FETCH_WINDOW`, never a disappearance). Both charge a successful
 * report.
 */
export function carriedFromAnswer(reason: string | undefined): boolean {
  return reason === "UNEXPLAINED_DISAPPEARANCE" || reason === "OUTSIDE_FETCH_WINDOW";
}

/**
 * A failed fetch never silently empties a previously full calendar: a
 * retrieval failure is not written into the data as an absence.
 *
 * Meetings the previous snapshot held for a source that failed this run, or
 * for a division a partially refused source could not reach, are carried
 * forward with their original `provenance.collectedAt`, and each carried row
 * is marked `carried: { source, lastFreshAt }`.
 *
 * - A fresh row always wins.
 * - The source's own window applies (see `backEdgeFor`): a sitting a healthy
 *   run would not have produced is not resurrected.
 * - Nothing is carried for a source that succeeded and reported no refusal:
 *   a body that stopped publishing may go quiet.
 */
export interface CarryForwardChild {
  source: string;
  ok: boolean;
  /** Divisions this source could not reach while otherwise succeeding. */
  unreachableOcdIds?: string[];
  /**
   * A scope that failed inside a source that succeeded: e.g. an iCal body's
   * archive feed refused while its upcoming feed answered. An `ARCHIVE`
   * failure carries back only sittings that had already concluded at `now`.
   */
  partialScopes?: PartialScopeFailure[];
  /**
   * The source's own `MeetingSource.publishedLookbackDays`. `null` means the
   * publisher's whole listed archive; omitted means the serving window.
   */
  publishedLookbackDays?: number | null;
}

export interface CarryForwardResult {
  meetings: Meeting[];
  /** Per source, how many rows came from the previous snapshot. */
  carried: Map<string, number>;
}

/**
 * Stamp a row as carried, never overwriting an older true stamp:
 * `lastFreshAt` is the row's own `provenance.collectedAt`, and a row already
 * marked keeps its mark. It records no reason, because the mark covers three
 * conditions (failed source, unreachable division, refused archive scope) and
 * no one sentence is true of all three.
 */
export function mark(meeting: Meeting, source: string, previousGeneratedAt: string): Meeting {
  if (meeting.carried) return meeting;
  const collected = meeting.provenance?.collectedAt;
  const lastFreshAt = Number.isFinite(Date.parse(collected ?? ""))
    ? (collected as string)
    : previousGeneratedAt;
  return { ...meeting, carried: { source, lastFreshAt } };
}

export function carryForward(
  children: CarryForwardChild[],
  fresh: Meeting[],
  previous: MeetingsSnapshot | null,
  now: Date,
): CarryForwardResult {
  const carried = new Map<string, number>();
  if (!previous) return { meetings: fresh, carried };

  const windowEnd = now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000;

  /**
   * The back edge, per source: the failed source's own declared lookback, not
   * one global constant, since some adapters publish a longer archive than
   * the serving window. `null` means no back clip; readers never see past
   * `CONCLUDED_LOOKBACK_DAYS` anyway, since `lib/meetings/query.ts` clips reads.
   */
  const backEdgeFor = (child: CarryForwardChild): number => {
    const declared = child.publishedLookbackDays;
    if (declared === null) return -Infinity;
    const days = declared ?? MEETING_HELD_LOOKBACK_DAYS;
    return now.getTime() - days * 86_400_000;
  };

  const haveId = new Set(fresh.map((m) => m.id));
  const out = [...fresh];

  for (const child of children) {
    // A source that failed outright loses everything it serves; a source that
    // succeeded loses only the divisions it says it could not reach.
    const wholeSource = !child.ok;
    const divisions = new Set(child.unreachableOcdIds ?? []);
    /*
     * The divisions whose archive refused while the source succeeded. A `null`
     * entry is a division-less body, kept rather than dropped.
     */
    const archiveScopes = (child.partialScopes ?? []).filter((p) => p.scope === "ARCHIVE");
    const archiveDivisions = new Set(archiveScopes.flatMap((p) => p.ocdIds));
    if (!wholeSource && divisions.size === 0 && archiveDivisions.size === 0) continue;

    const windowStart = backEdgeFor(child);
    let count = 0;
    for (const meeting of previous.meetings) {
      if (meeting.id.split(":")[0] !== child.source) continue;
      const inFailedDivision = wholeSource || Boolean(meeting.ocdId && divisions.has(meeting.ocdId));
      /*
       * An archive failure says nothing about the future, so only a sitting
       * already concluded at `now` is carried back on its account.
       */
      const inFailedScope =
        archiveDivisions.has(meeting.ocdId ?? null) &&
        Date.parse(meeting.startsAt) < now.getTime();
      if (!inFailedDivision && !inFailedScope) continue;
      if (haveId.has(meeting.id)) continue;
      const at = Date.parse(meeting.startsAt);
      if (!Number.isFinite(at) || at < windowStart || at > windowEnd) continue;
      out.push(mark(meeting, child.source, previous.generatedAt));
      haveId.add(meeting.id);
      count += 1;
    }
    if (count > 0) carried.set(child.source, count);
  }

  return { meetings: out, carried };
}
