import { countLabel } from "./labels.ts";
/** Shared by every writer and the hourly observer. Families are data, so new ones need no allowlist. */
export interface HourCount {
  readonly hour: string;
  readonly state: string;
  readonly family: string;
  readonly stage: string;
  readonly total: number;
  readonly closedTotal: number | null;
  readonly incoming: number | null;
  readonly outgoing: number | null;
  readonly changed: number | null;
  readonly observedIn?: number;
  readonly observedOut?: number;
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
export const COUNT_HOUR_SQL = `WITH coverage AS (
  SELECT min(hour) AS start FROM count_hour WHERE step='counter start'
), parsed AS (
  SELECT state,hour,n,CASE WHEN step LIKE 'v1:%' THEN substring(step FROM 4)::jsonb
    ELSE jsonb_build_array('Other facts',step,'events') END AS dimension FROM count_hour WHERE step<>'counter start'
), counters AS (
  SELECT state,hour,dimension->>0 AS family,dimension->>1 AS stage,dimension->>2 AS metric,n FROM parsed
)
SELECT $1::timestamptz AS hour,state,family,stage,
  coalesce(sum(CASE metric WHEN 'stock in' THEN n WHEN 'stock out' THEN -n WHEN 'events' THEN n ELSE 0 END)
    FILTER (WHERE hour <= $3::timestamptz),0)::bigint AS total,
  CASE WHEN (SELECT start FROM coverage) <= $2::timestamptz THEN coalesce(sum(CASE metric WHEN 'stock in' THEN n WHEN 'stock out' THEN -n WHEN 'events' THEN n ELSE 0 END)
    FILTER (WHERE hour < $2::timestamptz),0)::bigint ELSE NULL END AS closed_total,
  CASE WHEN (SELECT start FROM coverage) <= $1::timestamptz THEN coalesce(sum(n) FILTER (WHERE metric IN ('in','events') AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint ELSE NULL END AS incoming,
  coalesce(sum(n) FILTER (WHERE metric IN ('in','events') AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint AS observed_in,
  CASE WHEN (SELECT start FROM coverage) <= $1::timestamptz THEN coalesce(sum(n) FILTER (WHERE metric='out' AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint ELSE NULL END AS outgoing,
  coalesce(sum(n) FILTER (WHERE metric='out' AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint AS observed_out,
  CASE WHEN (SELECT start FROM coverage) <= $1::timestamptz THEN coalesce(sum(n) FILTER (WHERE metric='changed' AND hour >= $1::timestamptz AND hour < $2::timestamptz),0)::bigint ELSE NULL END AS changed
FROM counters GROUP BY state,family,stage ORDER BY state,family,stage`;


/** Closed hours use UTC keys; Eastern formatting includes its zone to distinguish the repeated fall hour. */
export function countWindow(at: string) {
  const through = Math.floor(Date.parse(at) / 3_600_000) * 3_600_000;
  if (!Number.isFinite(through)) throw Error("Invalid hourly count clock");
  return { from: new Date(through - 3_600_000).toISOString(), through: new Date(through).toISOString() };
}
export function countProblems(current: readonly HourCount[], previous: readonly HourCount[], waiting: readonly OldestWaiting[], at: string): CountProblem[] {
  const problems: CountProblem[] = [];
  for(const row of current.filter(row=>row.stage==='cache')) {
    const failed=(row.observedIn??row.incoming??0)-(row.observedOut??row.outgoing??0);
    if(failed>0)problems.push({key:`counts:${row.state}:${row.family}:${row.stage}`,where:`${row.state} · reader updates`,
      says:`${failed.toLocaleString("en-US")} reader cache refresh${failed===1?'':'es'} failed in the recorded part of the hour.`,owner:"the runner",
      next:"Repair the cache refresh and check the published records on the live page."});
  }
  const old = new Map(previous.map(row => [JSON.stringify([row.state,row.family,row.stage]),row]));
  for (const row of waiting) {
    const key = JSON.stringify([row.state,row.family,row.stage]);
    const now = current.find(c => JSON.stringify([c.state,c.family,c.stage]) === key);
    const before = old.get(key);
    const age = row.oldestAt === null ? null : Date.parse(at) - Date.parse(row.oldestAt);
    if(row.count>0&&row.oldestAt===null) {
      problems.push({key:`count-age:${row.state}:${row.family}:${row.stage}`,where:`${row.state} · ${countLabel(row.family)}`,
        says:"Waiting work has no recorded starting time.",owner:row.owner,next:"Restore the waiting time on this work list."});
      continue;
    }
    const growing=before?.closedTotal!==null&&before?.closedTotal!==undefined&&row.count>before.closedTotal;
    const partialGrowth=(now?.observedIn??0)>(now?.observedOut??0);
    const aged=row.count>0&&age!==null&&age>=3_600_000;
    const expired=row.stage==='work list:EXPIRED'&&row.count>0;
    const flat=aged&&now?.outgoing===0;
    const unknownFlow=aged&&(now?.outgoing===null||now===undefined);
    if(!growing&&!partialGrowth&&!flat&&!unknownFlow&&!expired)continue;
    const says=expired?`${row.count.toLocaleString("en-US")} worker leases expired and the work is still waiting.`:
      growing?`${row.count.toLocaleString("en-US")} items are waiting; the pile grew since the previous hour.`:
      partialGrowth?`${row.count.toLocaleString("en-US")} items are waiting; more came in than moved on in the recorded part of this hour.`:
      flat?`${row.count.toLocaleString("en-US")} items are waiting and none moved on in the last full hour.`:
      `${row.count.toLocaleString("en-US")} items are waiting; the oldest has waited at least an hour.`;
    problems.push({key:`counts:${row.state}:${row.family}:${row.stage}`,where:`${row.state} · ${countLabel(row.family)}`,
      says,owner:expired?"the runner":row.owner,next:"Repair the blocked handoff and check the same records on the live page."});
  }
  return problems;
}
