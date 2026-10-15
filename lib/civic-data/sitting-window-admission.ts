import { and, eq, inArray, sql } from "drizzle-orm";

import { sittingWindowHot, sittingWindowRereadMs, type SittingWindowSchedule } from "./contracts.ts";
import { civicDataPromotions } from "../db/schema.ts";

/** An hourly read, or a retry, is eligible this long before its deadline. */
export const SITTING_WINDOW_ADMISSION_LEAD_MS = 25 * 60_000;
/** A twice-daily read is eligible this long before its deadline. */
export const SITTING_WINDOW_BASE_ADMISSION_LEAD_MS = 2 * 60 * 60_000;
/** A sitting without an end time counts as concluded no later than this after it starts. */
export const SITTING_CONCLUSION_BOUND_MS = 24 * 60 * 60_000;

export type StatedSittingEnds = ReadonlyMap<string, number>;

export function sittingConclusionMs(start: string, statedEnds?: StatedSittingEnds): number {
  const at = Date.parse(start);
  const stated = statedEnds?.get(start);
  return stated !== undefined && Number.isFinite(stated) && stated >= at ? stated : at + SITTING_CONCLUSION_BOUND_MS;
}

/** `undefined` means the sitting list could not be read, which reads as hot. */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statedSittingEndsRead(db: any, scopes: readonly string[]) {
  const payload = civicDataPromotions.payload;
  const pairs = sql<unknown>`(
    select coalesce(jsonb_agg(jsonb_build_array(m->'startsAt', m->'endsAt')), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(${payload}->'meetings') = 'array' then ${payload}->'meetings' else '[]'::jsonb end) as m
    where jsonb_typeof(m->'startsAt') = 'string' and jsonb_typeof(m->'endsAt') = 'string'
  )`;
  return db
    .select({ scope: civicDataPromotions.scope, pairs })
    .from(civicDataPromotions)
    .where(and(eq(civicDataPromotions.recordClass, "MEETING"), inArray(civicDataPromotions.scope, [...scopes])));
}

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

export interface SittingWindowReads {
  readonly attemptedMs: number;
  /** NaN when no success is proven. */
  readonly succeededMs: number;
  readonly published: boolean;
}

export interface SittingWindowObligation {
  readonly deadlineMs: number;
  readonly eligibleAtMs: number;
}

export function sittingWindowObligation(
  schedule: SittingWindowSchedule,
  retryMs: number,
  reads: SittingWindowReads,
  hot: boolean | undefined,
): SittingWindowObligation {
  const rereadMs = sittingWindowRereadMs(schedule, hot);
  const [fromMs, periodMs] = !Number.isFinite(reads.succeededMs)
    ? [reads.attemptedMs, reads.published ? Math.min(sittingWindowRetryMs(schedule, retryMs, true), rereadMs) : sittingWindowRetryMs(schedule, retryMs, false)]
    : reads.attemptedMs > reads.succeededMs
      ? [reads.attemptedMs, Math.min(retryMs, rereadMs)]
      : [reads.succeededMs, rereadMs];
  const leadMs = periodMs >= schedule.baseEveryMs ? SITTING_WINDOW_BASE_ADMISSION_LEAD_MS : SITTING_WINDOW_ADMISSION_LEAD_MS;
  return { deadlineMs: fromMs + periodMs, eligibleAtMs: fromMs + periodMs - leadMs };
}
