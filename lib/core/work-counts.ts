import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { Query } from "../facts/publish.ts";

interface Hour {
  readonly state: string;
  readonly hour: string;
  readonly incoming: number;
  readonly done: number;
  readonly refused: number;
}

/** Small hourly totals, including the states with no rows. Never opens the work payloads. */
export async function workCounts(query: Query, state: string | null, now: Date): Promise<readonly Hour[]> {
  const regions = [...REGISTRY_STATES.map(value => value.toLowerCase()), "system"];
  if (state !== null && !regions.includes(state.toLowerCase())) throw new Error("WORK_INVALID_STATE");
  const rows = await query(`SELECT regions.state, hours.hour,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_in'),0)::text AS incoming,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_done'),0)::text AS done,
    coalesce(sum(c.n) FILTER (WHERE c.step = 'work_refused'),0)::text AS refused
    FROM unnest($1::text[]) AS regions(state)
    CROSS JOIN generate_series(date_trunc('hour',$2::timestamptz) - interval '23 hours', date_trunc('hour',$2::timestamptz), interval '1 hour') AS hours(hour)
    LEFT JOIN count_hour c ON c.state = regions.state AND c.hour = hours.hour
      AND c.step IN ('work_in','work_done','work_refused')
    GROUP BY regions.state, hours.hour ORDER BY hours.hour DESC, regions.state`,
  [state === null ? regions : [state.toLowerCase()], now.toISOString()]);
  return rows.map(row => ({ state: String(row.state), hour: new Date(row.hour as string | Date).toISOString(),
    incoming: Number(row.incoming), done: Number(row.done), refused: Number(row.refused) }));
}
