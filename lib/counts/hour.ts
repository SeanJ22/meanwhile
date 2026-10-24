/** Shared by every writer and the hourly observer. Families are data, so new ones need no allowlist. */
export interface HourCount {
  readonly hour: string;
  readonly state: string;
  readonly family: string;
  readonly stage: string;
  readonly total: number;
  readonly closedTotal: number;
  readonly incoming: number;
  readonly outgoing: number;
  readonly changed: number;
}
export interface OldestWaiting {
  readonly state: string;
  readonly family: string;
  readonly stage: string;
  readonly count: number;
  readonly oldestAt: string | null;
  readonly owner: string;
}
export interface CountProblem {
  readonly key: string;
  readonly where: string;
  readonly says: string;
  readonly owner: string;
  readonly next: string;
}
export const COUNT_HOUR_SQL = `WITH parsed AS (
  SELECT state,hour,n,CASE WHEN step LIKE 'v1:%' THEN substring(step FROM 4)::jsonb
    ELSE jsonb_build_array('Other facts',step,'events') END AS dimension FROM count_hour
), counters AS (
  SELECT state,hour,dimension->>0 AS family,dimension->>1 AS stage,dimension->>2 AS metric,n FROM parsed
)
SELECT $1::timestamptz AS hour,state,family,stage,
  coalesce(sum(CASE metric WHEN 'stock in' THEN n WHEN 'stock out' THEN -n WHEN 'events' THEN n ELSE 0 END)
    FILTER (WHERE hour <= $3::timestamptz),0)::bigint AS total,
  coalesce(sum(CASE metric WHEN 'stock in' THEN n WHEN 'stock out' THEN -n WHEN 'events' THEN n ELSE 0 END)
    FILTER (WHERE hour < $2::timestamptz),0)::bigint AS closed_total,
  coalesce(sum(n) FILTER (WHERE metric IN ('in','events') AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint AS incoming,
  coalesce(sum(n) FILTER (WHERE metric='out' AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint AS outgoing,
  coalesce(sum(n) FILTER (WHERE metric='changed' AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint AS changed
FROM counters GROUP BY state,family,stage ORDER BY state,family,stage`;


/** Closed hours use UTC keys; Eastern formatting includes its zone to distinguish the repeated fall hour. */
export function countWindow(at: string) {
  const through = Math.floor(Date.parse(at) / 3_600_000) * 3_600_000;
  if (!Number.isFinite(through)) throw Error("Invalid hourly count clock");
  return { from: new Date(through - 3_600_000).toISOString(), through: new Date(through).toISOString() };
}
export function countProblems(current: readonly HourCount[], previous: readonly HourCount[], waiting: readonly OldestWaiting[], at: string): CountProblem[] {
  const problems: CountProblem[] = [];
  const old = new Map(previous.map(row => [JSON.stringify([row.state,row.family,row.stage]),row]));
  for (const row of waiting) {
    const key = JSON.stringify([row.state,row.family,row.stage]);
    const now = current.find(c => JSON.stringify([c.state,c.family,c.stage]) === key);
    const before = old.get(key);
    const age = row.oldestAt === null ? null : Date.parse(at) - Date.parse(row.oldestAt);
    if(row.count>0&&row.oldestAt===null) {
      problems.push({key:`count-age:${row.state}:${row.family}:${row.stage}`,where:`${row.state} · ${row.family}`,
        says:"Waiting work has no recorded starting time.",owner:row.owner,next:"Restore the waiting time on this work list."});
      continue;
    }
    const growing = before !== undefined && row.count > before.closedTotal;
    const flat = row.count > 0 && age !== null && age >= 3_600_000 && (now?.outgoing ?? 0) === 0;
    if (!growing && !flat) continue;
    problems.push({key:`counts:${row.state}:${row.family}:${row.stage}`,where:`${row.state} · ${row.family}`,
      says:growing ? `${row.count.toLocaleString("en-US")} items are waiting; the pile grew since the previous hour.`
        : `${row.count.toLocaleString("en-US")} items are waiting and none moved on in the last hour.`,
      owner:row.owner,next:"Repair the blocked handoff and check the same records on the live page."});
  }
  return problems;
}
