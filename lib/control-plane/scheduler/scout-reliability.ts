import type { ControlPlaneRepositories } from '../repository/types.ts';
import { readCompletedWorkerResults } from '../repository/worker-completion.ts';
import { FIRST_BACKOFF_MINUTES, MAX_BACKOFF_MINUTES } from './debt.ts';

export interface SourceReliability {
  source: string; successes: number; failures: number; consecutiveFailures: number;
  lastAttemptAt: string; retryAt: string | null; detail: string;
}
/** One Legistar tenant cannot back off every government using the same vendor. */
export function sourceReliabilityKey(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname === 'webapi.legistar.com'
    ? `${parsed.origin}/${parsed.pathname.split('/').filter(Boolean).slice(0,2).join('/')}` : parsed.origin;
}
/** Admin and dispatch read the same existing completed acquisition results. No new ledger. */
export async function readSourceReliability(repos: ControlPlaneRepositories): Promise<SourceReliability[]> {
  const rows = (await readCompletedWorkerResults(repos)).filter(row => row.result.role === 'ACQUIRER')
    .sort((a,b) => a.endedAt.localeCompare(b.endedAt));
  const sources = new Map<string, SourceReliability>();
  for (const row of rows) {
    const result = row.result;
    if (result.role !== 'ACQUIRER' || result.requestCount === 0) continue;
    const source = sourceReliabilityKey(result.source.url);
    const previous = sources.get(source);
    const success = result.verdict === 'ACQUIRED';
    const consecutiveFailures = success ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
    sources.set(source, {source,successes:(previous?.successes ?? 0)+(success?1:0),failures:(previous?.failures ?? 0)+(success?0:1),
      consecutiveFailures,lastAttemptAt:row.endedAt,
      retryAt:success?null:new Date(Date.parse(row.endedAt)+Math.min(MAX_BACKOFF_MINUTES,FIRST_BACKOFF_MINUTES*2**Math.min(consecutiveFailures-1,20))*60000).toISOString(),
      detail:success?'Source returned captured data':result.blockers.map(b=>b.description).join('; ')});
  }
  return [...sources.values()];
}
