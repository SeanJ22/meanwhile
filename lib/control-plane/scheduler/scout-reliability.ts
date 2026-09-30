import type { ControlPlaneRepositories } from '../repository/types.ts';
import { readCompletedWorkerResults } from '../repository/worker-completion.ts';
import { FIRST_BACKOFF_MINUTES, MAX_BACKOFF_MINUTES } from './debt.ts';

export interface SourceReliability {
  source: string; successes: number; failures: number; consecutiveFailures: number;
  lastAttemptAt: string; retryAt: string | null; detail: string;
}
/** Completed acquisitions that made a request; callers project only these fields. */
export interface SourceReliabilityRow {
  url: string;
  verdict: string;
  endedAt: string;
  blockerText: readonly string[];
  blockerCodes?: readonly string[];
}
/** One Legistar tenant cannot back off every government using the same vendor. */
export function sourceReliabilityKey(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname === 'webapi.legistar.com'
    ? `${parsed.origin}/${parsed.pathname.split('/').filter(Boolean).slice(0,2).join('/')}` : parsed.origin;
}
/** Shared by dispatch and Admin's bounded SQL projection; does not mutate input rows. */
export function reduceSourceReliability(rows: readonly SourceReliabilityRow[]): SourceReliability[] {
  const sources = new Map<string, SourceReliability>();
  for (const row of [...rows].sort((a,b) => a.endedAt.localeCompare(b.endedAt))) {
    // Historical robots-only refusals never tested the publisher's data route.
    if (row.blockerCodes?.length && row.blockerCodes.every(code =>
      code === 'PERMISSION_DENIED' || code === 'PERMISSION_UNKNOWN')) continue;
    const source = sourceReliabilityKey(row.url);
    const previous = sources.get(source);
    const success = row.verdict === 'ACQUIRED';
    const consecutiveFailures = success ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
    sources.set(source, {source,successes:(previous?.successes ?? 0)+(success?1:0),failures:(previous?.failures ?? 0)+(success?0:1),
      consecutiveFailures,lastAttemptAt:row.endedAt,
      retryAt:success?null:new Date(Date.parse(row.endedAt)+Math.min(MAX_BACKOFF_MINUTES,FIRST_BACKOFF_MINUTES*2**Math.min(consecutiveFailures-1,20))*60000).toISOString(),
      detail:success?'Source returned captured data':row.blockerText.join('; ')});
  }
  return [...sources.values()];
}

/** Dispatch reads existing completed acquisition results; no new store. */
export async function readSourceReliability(repos: ControlPlaneRepositories): Promise<SourceReliability[]> {
  const rows = (await readCompletedWorkerResults(repos)).flatMap(row => {
    const result = row.result;
    return result.role === 'ACQUIRER' && result.requestCount > 0
      ? [{ url: result.source.url, verdict: result.verdict, endedAt: row.endedAt,
          blockerText: result.blockers.map(blocker => blocker.description),
          blockerCodes: result.blockers.map(blocker => blocker.code) }]
      : [];
  });
  return reduceSourceReliability(rows);
}
