import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

/** Counts are events in this window, not the current queue sizes. Findings and
 * reader records are named separately: several findings can build one record.
 * Live facts means newly added/changed reader records; rechecks earn no credit. */
export interface FlowHour {
  readonly hour: string;
  readonly findings: number;
  readonly builtFindings: number;
  readonly checkedRecords: number;
  readonly liveRecords: number;
  readonly settledSpendUsd: number | null;
  readonly unpricedCharges: number;
}
export interface FlowRead {
  readonly from: string;
  readonly through: string;
  readonly hours: readonly FlowHour[];
  readonly factsLivePerHour: number;
  readonly settledSpendUsd: number | null;
  readonly costPerFactUsd: number | null;
  readonly unit: "new or updated reader records";
}
export interface FlowRows {
  readonly stages: readonly { hour: string; stage: "findings" | "builtFindings" | "checkedRecords" | "liveRecords"; count: number }[];
  readonly spend: readonly { hour: string; usd: number; unpriced: number }[];
}
const HOUR = 3_600_000;
export function projectFlow(rows: FlowRows, from: string, through: string): FlowRead {
  const start = Date.parse(from), end = Date.parse(through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 7 * 24 * HOUR) throw Error("FLOW_WINDOW_INVALID");
  const hours = new Map<string, { hour: string; findings: number; builtFindings: number; checkedRecords: number; liveRecords: number; settledSpendUsd: number | null; unpricedCharges: number }>();
  for (let at = Math.floor(start / HOUR) * HOUR; at < end; at += HOUR) {
    const hour = new Date(at).toISOString();
    hours.set(hour, { hour, findings: 0, builtFindings: 0, checkedRecords: 0, liveRecords: 0, settledSpendUsd: 0, unpricedCharges: 0 });
  }
  for (const row of rows.stages) {
    if (!Number.isSafeInteger(row.count) || row.count < 0) throw Error("FLOW_COUNT_INVALID");
    const hour = hours.get(new Date(row.hour).toISOString());
    if (hour) hour[row.stage] += row.count;
  }
  for (const row of rows.spend) {
    if (!Number.isFinite(row.usd) || row.usd < 0 || !Number.isSafeInteger(row.unpriced) || row.unpriced < 0) throw Error("FLOW_SPEND_INVALID");
    const hour = hours.get(new Date(row.hour).toISOString());
    if (hour) { hour.unpricedCharges += row.unpriced; hour.settledSpendUsd = hour.unpricedCharges ? null : (hour.settledSpendUsd ?? 0) + row.usd; }
  }
  const values = [...hours.values()], facts = values.reduce((n, h) => n + h.liveRecords, 0);
  const settledSpendUsd = values.some(h => h.settledSpendUsd === null) ? null : values.reduce((n, h) => n + h.settledSpendUsd!, 0);
  return { from, through, hours: values, factsLivePerHour: facts / ((end - start) / HOUR), settledSpendUsd,
    costPerFactUsd: facts && settledSpendUsd !== null ? settledSpendUsd / facts : null, unit: "new or updated reader records" };
}

// Server-side aggregates: no Scout text, candidate payload, or entire cost
// history travels to Admin. First arrival/build counts once despite replay.
export const BOX_FLOW_SQL = `WITH events AS (
 SELECT id, 'findings' AS stage, (SELECT min((o->>'recordedAt')::timestamptz) FROM jsonb_array_elements(value->'origins') o) AS at FROM cp_box_findings
 UNION ALL
 SELECT id, 'builtFindings', (SELECT min((a->>'endedAt')::timestamptz) FROM jsonb_array_elements(value->'attempts') a WHERE a->>'outcome' = 'built') FROM cp_box_findings
) SELECT date_trunc('hour', at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour, stage, count(*)::int AS count
 FROM events WHERE at >= $1::timestamptz AND at < $2::timestamptz GROUP BY 1, 2`;
export const PUBLICATION_FLOW_SQL = `SELECT date_trunc('hour', recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour,
 CASE record->'publicationFlow'->>'stage' WHEN 'CHECKED' THEN 'checkedRecords' ELSE 'liveRecords' END AS stage,
 sum(CASE record->'publicationFlow'->>'stage' WHEN 'CHECKED' THEN (record->'publicationFlow'->>'records')::int ELSE (record->'publicationFlow'->>'changedRecords')::int END)::int AS count
 FROM cp_log_owner_digests WHERE log_key = 'publication-flow' AND recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz GROUP BY 1, 2`;
export const FLOW_SPEND_SQL = `SELECT date_trunc('hour', recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour,
 coalesce(sum((record->'cost'->>'usd')::float8), 0)::float8 AS usd,
 count(*) FILTER (WHERE record->'cost'->>'usd' IS NULL)::int AS unpriced
 FROM cp_log_costs WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz
 AND (record->>'role' <> 'ACQUIRER' OR record->'cost'->>'usd' IS NOT NULL) GROUP BY 1`;

/** Caller supplies the actual deployment time: older uninstrumented hours must
 * not appear as zero. An unavailable store remains unknown on the Admin card. */
export async function readFlow(input: { control: Sql; from: string; through: string; recordingSince: string }): Promise<FlowRead> {
  const from = new Date(Math.max(Date.parse(input.from), Date.parse(input.recordingSince))).toISOString();
  projectFlow({ stages: [], spend: [] }, from, input.through);
  const args = [from, input.through];
  const [box, publication, spend] = await Promise.all([
    boundedQuery(input.control, { operation: "box.hourly_flow", callClass: "PAGE" }, BOX_FLOW_SQL, args),
    boundedQuery(input.control, { operation: "publication.hourly_flow", callClass: "PAGE" }, PUBLICATION_FLOW_SQL, args),
    boundedQuery(input.control, { operation: "costs.hourly_flow", callClass: "PAGE" }, FLOW_SPEND_SQL, args),
  ]) as [FlowRows["stages"], FlowRows["stages"], FlowRows["spend"]];
  return projectFlow({ stages: [...box, ...publication], spend }, from, input.through);
}

/* ---------------------------------------------------------------- the week (BR-31) */

const DAY = 24 * HOUR;
export const FLOW_WEEK_DAYS = 7;

/** One trailing 24-hour window of the week; null when nothing was recorded for any of it yet. */
export interface FlowDay {
  readonly from: string;
  readonly through: string;
  readonly read: FlowRead | null;
}
export interface FlowWeek {
  readonly days: readonly FlowDay[];
  /** Hours actually recorded across the week; uninstrumented hours are not counted. */
  readonly hoursRecorded: number;
  readonly liveRecords: number;
  readonly factsLivePerHour: number | null;
  readonly settledSpendUsd: number | null;
  readonly costPerFactUsd: number | null;
  /** Hours in the week whose spend had a charge with no price; the cost is then unknown, not low. */
  readonly unpricedHours: number;
}

const hoursOf = (r: FlowRead): number => (Date.parse(r.through) - Date.parse(r.from)) / HOUR;

/** PURE: the week's totals from its days. Cost per fact is spend over facts across the same recorded hours. */
export function summarizeFlowWeek(days: readonly FlowDay[]): FlowWeek {
  const reads = days.flatMap((d) => (d.read === null ? [] : [d.read]));
  const hoursRecorded = reads.reduce((n, r) => n + hoursOf(r), 0);
  const liveRecords = reads.reduce((n, r) => n + r.hours.reduce((m, h) => m + h.liveRecords, 0), 0);
  const unpricedHours = reads.reduce((n, r) => n + r.hours.filter((h) => h.settledSpendUsd === null).length, 0);
  const settledSpendUsd = reads.length === 0 || unpricedHours > 0 ? null : reads.reduce((n, r) => n + (r.settledSpendUsd ?? 0), 0);
  return {
    days, hoursRecorded, liveRecords, unpricedHours, settledSpendUsd,
    factsLivePerHour: hoursRecorded > 0 ? liveRecords / hoursRecorded : null,
    costPerFactUsd: liveRecords > 0 && settledSpendUsd !== null ? settledSpendUsd / liveRecords : null,
  };
}

export const FLOW_RECORDING_SINCE_SQL = `SELECT min(recorded_at) AS since FROM cp_log_owner_digests WHERE log_key = 'publication-flow'`;

/** When the live-record counts began: the first publication-flow record. Null when none has been written. */
export async function readFlowRecordingSince(control: Sql): Promise<string | null> {
  const rows = await boundedQuery(control, { operation: "publication.flow_since", callClass: "PAGE" }, FLOW_RECORDING_SINCE_SQL, []) as { since: string | Date | null }[];
  const since = rows[0]?.since;
  return since === null || since === undefined ? null : new Date(since).toISOString();
}

/** The last seven 24-hour windows ending at `through`. A window wholly before recording began is null, never zeros. */
export async function readFlowWeek(input: { control: Sql; through: string; lastDay?: {readonly from:string;readonly through:string} }): Promise<FlowWeek | null> {
  if (input.lastDay && (Date.parse(input.lastDay.through) !== Date.parse(input.through) || Date.parse(input.lastDay.from) >= Date.parse(input.through))) throw new Error("Invalid last-day window");
  const since = await readFlowRecordingSince(input.control);
  if (since === null) return null;
  const end = Date.parse(input.through);
  const days = await Promise.all(Array.from({ length: FLOW_WEEK_DAYS }, async (_, i): Promise<FlowDay> => {
    const through = new Date(end - (FLOW_WEEK_DAYS - 1 - i) * DAY).toISOString();
    const from = i === FLOW_WEEK_DAYS - 1 && input.lastDay ? input.lastDay.from : new Date(end - (FLOW_WEEK_DAYS - i) * DAY).toISOString();
    if (Date.parse(through) <= Date.parse(since)) return { from, through, read: null };
    return { from, through, read: await readFlow({ control: input.control, from, through, recordingSince: since }) };
  }));
  return summarizeFlowWeek(days);
}
