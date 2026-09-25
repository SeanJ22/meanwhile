/**
 * **WHEN A MEETING BODY MUST BE READ, AND WHEN THE RUNNER MAY READ IT (C6).**
 *
 * The owner's rule (2026-09-24): every meeting body is read twice daily, and
 * hourly while it has a meeting in the next seven days or one that concluded
 * in the previous seven. "Hourly" is at most 60 minutes between reads and
 * "twice daily" at most 12 hours: those are the deadlines, and nothing here
 * treats a later read as on time.
 *
 * - **Conclusion.** A sitting concludes at its stated end when the publisher
 *   states one (3 of 880 promoted sittings on 2026-09-25, all Tucson Unified).
 *   Otherwise the scheduler counts it concluded up to a day after it starts: of
 *   443 publisher-stated durations read on 2026-09-25 (those 3 and every event
 *   in Flagstaff's catID 49 feed) the longest was 15 h and none reached 24 h.
 *   The day is a scheduling bound only. It is never stored as an end or shown
 *   to a reader, and a stated end, longer or shorter, always replaces it.
 * - **Lead.** An hourly read becomes eligible 25 minutes before its deadline. A
 *   pass starts on the first one-minute tick at least five minutes after the
 *   last one started and after the last one ended, and a pass lasts as long as
 *   its slowest child, reader repairs included. Over 196 production passes
 *   (2026-09-24 5:00 AM to 11:00 PM MST) a pass took 1:34 at the median, 10:58
 *   at p99 and 15:52 at most, so a read eligible just as a long pass began waited
 *   up to about 17 minutes for the next one, and a lane then has its backlog to
 *   clear. The lead covers that wait, up to two earlier reads on the same lane
 *   with the one-minute gaps, and the child's start. A read made due at 55
 *   minutes landed at 60:08-62:05.
 *   A twice-daily read becomes eligible 2 hours early, so the lane reads it in
 *   slots the hourly bodies leave free: twice-daily reads that fell due together
 *   (as after the B3 switch) spread out instead of returning as the same burst
 *   every 12 hours.
 * - **Never published (R20).** A partition with no promotion has no meeting on
 *   record, so it takes the twice-daily deadline after each attempt, not the
 *   contract's one-hour failure retry. Never-published retries had taken 4.2 of
 *   New London's 12 reads an hour.
 *
 * The runner admits on these instants and orders each lane by deadline; Admin
 * shows the same instants.
 */
import { and, eq, sql } from "drizzle-orm";

import { sittingWindowHot, sittingWindowRereadMs, type SittingWindowSchedule } from "./contracts.ts";
import { civicDataPromotions } from "../db/schema.ts";

/** An hourly read, or a retry, is eligible this long before its deadline. */
export const SITTING_WINDOW_ADMISSION_LEAD_MS = 25 * 60_000;
/** A twice-daily read is eligible this long before its deadline. */
export const SITTING_WINDOW_BASE_ADMISSION_LEAD_MS = 2 * 60 * 60_000;
/** A sitting without an end time counts as concluded no later than this after it starts. */
export const SITTING_CONCLUSION_BOUND_MS = 24 * 60 * 60_000;

/** A publisher-stated end, by the sitting's start as published (`startsAt`). */
export type StatedSittingEnds = ReadonlyMap<string, number>;

/** When a sitting concludes for scheduling: its stated end, or the day bound. */
export function sittingConclusionMs(start: string, statedEnds?: StatedSittingEnds): number {
  const at = Date.parse(start);
  const stated = statedEnds?.get(start);
  return stated !== undefined && Number.isFinite(stated) && stated >= at ? stated : at + SITTING_CONCLUSION_BOUND_MS;
}

/**
 * Hot by the owner's rule: a sitting starting within the window ahead, or one
 * that concluded within the window behind (`sittingConclusionMs`).
 * `undefined` means a sitting list could not be read, which reads as hot.
 */
export function sittingWindowHotByConclusion(
  schedule: SittingWindowSchedule,
  sittingLists: readonly (readonly string[] | undefined)[],
  nowMs: number,
  statedEnds?: StatedSittingEnds,
): boolean | undefined {
  const byStart = sittingWindowHot(schedule, sittingLists, nowMs);
  if (byStart === true) return true;
  const concluded = sittingLists.map((starts) => starts?.map((start) => {
    const at = sittingConclusionMs(start, statedEnds);
    return Number.isFinite(at) ? new Date(at).toISOString() : start;
  }));
  return sittingWindowHot(schedule, concluded, nowMs) === true ? true : byStart;
}

/** Every stated end a MEETING payload carries, by start; the memory twin of `statedSittingEndsRead`. */
export function meetingPayloadStatedEnds(payload: unknown): Map<string, number> {
  const meetings = payload && typeof payload === "object" ? (payload as { meetings?: unknown }).meetings : undefined;
  const ends = new Map<string, number>();
  if (!Array.isArray(meetings)) return ends;
  for (const meeting of meetings) {
    const { startsAt, endsAt } = (meeting && typeof meeting === "object" ? meeting : {}) as { startsAt?: unknown; endsAt?: unknown };
    if (typeof startsAt !== "string" || typeof endsAt !== "string") continue;
    const end = Date.parse(endsAt);
    if (Number.isFinite(end)) ends.set(startsAt, Math.max(end, ends.get(startsAt) ?? Number.NEGATIVE_INFINITY));
  }
  return ends;
}

/**
 * Every promoted MEETING scope's stated ends, as [start, end] pairs built in
 * Postgres: only sittings that state both, and never a payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statedSittingEndsRead(db: any) {
  const payload = civicDataPromotions.payload;
  const pairs = sql<unknown>`(
    select coalesce(jsonb_agg(jsonb_build_array(m->'startsAt', m->'endsAt')), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(${payload}->'meetings') = 'array' then ${payload}->'meetings' else '[]'::jsonb end) as m
    where jsonb_typeof(m->'startsAt') = 'string' and jsonb_typeof(m->'endsAt') = 'string'
  )`;
  return db
    .select({ scope: civicDataPromotions.scope, pairs })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, "MEETING"), sql`${pairs} <> '[]'::jsonb`));
}

/** The stated ends by scope, from `statedSittingEndsRead` rows. */
export function statedSittingEndsByScope(rows: readonly { readonly scope: string; readonly pairs: unknown }[]): Map<string, Map<string, number>> {
  const byScope = new Map<string, Map<string, number>>();
  for (const { scope, pairs } of rows) {
    if (!Array.isArray(pairs)) continue;
    const ends = new Map<string, number>();
    for (const pair of pairs) {
      if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") continue;
      const end = Date.parse(pair[1]);
      if (Number.isFinite(end)) ends.set(pair[0], Math.max(end, ends.get(pair[0]) ?? Number.NEGATIVE_INFINITY));
    }
    if (ends.size > 0) byScope.set(scope, ends);
  }
  return byScope;
}

export function sittingWindowRetryMs(
  schedule: SittingWindowSchedule,
  retryMs: number,
  published: boolean,
): number {
  return published ? retryMs : Math.max(retryMs, schedule.baseEveryMs);
}

/** What a sitting-window deadline is computed from: store-observed instants, in ms. */
export interface SittingWindowReads {
  readonly attemptedMs: number;
  /** NaN when no success is proven. */
  readonly succeededMs: number;
  /** The scope holds a promotion. */
  readonly published: boolean;
}

export interface SittingWindowObligation {
  /** The instant by which the next read is owed. */
  readonly deadlineMs: number;
  /** The instant the runner may admit it. */
  readonly eligibleAtMs: number;
}

/** The next read a sitting-window task owes, and when the runner may make it. */
export function sittingWindowObligation(
  schedule: SittingWindowSchedule,
  retryMs: number,
  reads: SittingWindowReads,
  hot: boolean | undefined,
): SittingWindowObligation {
  const [fromMs, periodMs] = !Number.isFinite(reads.succeededMs)
    ? [reads.attemptedMs, sittingWindowRetryMs(schedule, retryMs, reads.published)]
    : reads.attemptedMs > reads.succeededMs
      ? [reads.attemptedMs, retryMs]
      : [reads.succeededMs, sittingWindowRereadMs(schedule, hot)];
  const leadMs = periodMs >= schedule.baseEveryMs ? SITTING_WINDOW_BASE_ADMISSION_LEAD_MS : SITTING_WINDOW_ADMISSION_LEAD_MS;
  return { deadlineMs: fromMs + periodMs, eligibleAtMs: fromMs + periodMs - leadMs };
}
