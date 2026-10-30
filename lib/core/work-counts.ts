import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { Query } from "../facts/publish.ts";
import type { WorkKind, WorkTier } from "./work-kinds.ts";

interface Hour {
  readonly state: string;
  readonly hour: string;
  readonly incoming: number;
  readonly done: number;
  readonly refused: number;
}

/** Small hourly totals, including the states with no rows. Never opens the work payloads. */
export async function workCounts(query: Query, state: string | null, now: Date): Promise<readonly Hour[]> {
  const regions = [...REGISTRY_STATES, "US"];
  if (state !== null && !regions.includes(state.toUpperCase())) throw new Error("WORK_INVALID_STATE");
  const rows = await query(`SELECT regions.state, hours.hour,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_in'),0)::text AS incoming,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_done'),0)::text AS done,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_refused'),0)::text AS refused
    FROM unnest($1::text[]) AS regions(state)
    CROSS JOIN generate_series(date_trunc('hour',$2::timestamptz) - interval '23 hours', date_trunc('hour',$2::timestamptz), interval '1 hour') AS hours(hour)
    LEFT JOIN count_hour c ON c.state = regions.state AND c.hour = hours.hour
      AND c.step IN ('work_in','work_done','work_refused')
    GROUP BY regions.state, hours.hour ORDER BY hours.hour DESC, regions.state`,
  [state === null ? regions : [state.toUpperCase()], now.toISOString()]);
  return rows.map(row => ({ state: String(row.state).toLowerCase(), hour: new Date(row.hour as string | Date).toISOString(),
    incoming: Number(row.incoming), done: Number(row.done), refused: Number(row.refused) }));
}

export interface Waiting { readonly kind: WorkKind; readonly tier: WorkTier; readonly waiting: number }

/** What is waiting now, by kind and tier, and since when the oldest link to read has waited. Forty small counters and one probe of each state's first waiting link are read; no job is opened. */
export async function workWaiting(query: Query): Promise<{ readonly rows: readonly Waiting[]; readonly changedAt: string | null; readonly oldestLead: string | null }> {
  const rows = await query("SELECT kind,tier,n::text AS waiting,changed_at FROM work_waiting WHERE n>0 ORDER BY kind,tier");
  const changed = rows.map(row => new Date(row.changed_at as string | Date).getTime());
  const [oldest] = rows.some(row => row.kind === "lead") ? await query(`SELECT min(head.due_at) AS oldest FROM unnest($1::text[]) AS s(state) CROSS JOIN LATERAL (
    SELECT due_at FROM work WHERE state = s.state AND kind = 'lead' AND status = 'waiting' ORDER BY due_at LIMIT 1) head`, [[...REGISTRY_STATES, "US"]]) : [];
  return { rows: rows.map(row => ({ kind: row.kind as WorkKind, tier: row.tier as WorkTier, waiting: Number(row.waiting) })),
    changedAt: changed.length ? new Date(Math.max(...changed)).toISOString() : null,
    oldestLead: oldest?.oldest ? new Date(oldest.oldest as string | Date).toISOString() : null };
}
