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
