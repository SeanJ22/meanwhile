import type { ControlPlaneRepositories } from '../repository/types.ts';
import { completedWorkerResults } from '../repository/worker-completion.ts';
import { withHistoryIndex } from '../workers/streamed-history.ts';
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
function foldSourceReliability(previous: SourceReliability | undefined, row: SourceReliabilityRow): SourceReliability | undefined {
  // Historical robots-only refusals never tested the publisher's data route.
  if (robotsOnly(row)) return undefined;
  const success = row.verdict === 'ACQUIRED';
  const consecutiveFailures = success ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
  return {source: sourceReliabilityKey(row.url),successes:(previous?.successes ?? 0)+(success?1:0),failures:(previous?.failures ?? 0)+(success?0:1),
    consecutiveFailures,lastAttemptAt:row.endedAt,
    retryAt:success?null:new Date(Date.parse(row.endedAt)+Math.min(MAX_BACKOFF_MINUTES,FIRST_BACKOFF_MINUTES*2**Math.min(consecutiveFailures-1,20))*60000).toISOString(),
    detail:success?'Source returned captured data':row.blockerText.join('; ')};
}
function robotsOnly(row: SourceReliabilityRow): boolean {
  return Boolean(row.blockerCodes?.length && row.blockerCodes.every(code =>
    code === 'PERMISSION_DENIED' || code === 'PERMISSION_UNKNOWN'));
}
/** Shared by dispatch and Admin's bounded SQL projection; does not mutate input rows. */
export function reduceSourceReliability(rows: readonly SourceReliabilityRow[]): SourceReliability[] {
  const sources = new Map<string, SourceReliability>();
  for (const row of [...rows].sort((a,b) => a.endedAt.localeCompare(b.endedAt))) {
    if (robotsOnly(row)) continue;
    const source = sourceReliabilityKey(row.url);
    const next = foldSourceReliability(sources.get(source), row);
    if (next) sources.set(source, next);
  }
  return [...sources.values()];
}

/** A dispatch needs the reliability of its own publisher, in recorded completion order. */
export async function readSourceReliability(repos: ControlPlaneRepositories, sourceUrl: string): Promise<SourceReliability[]> {
  const source = sourceReliabilityKey(sourceUrl);
  return withHistoryIndex(async db => {
    db.exec('CREATE TABLE acquisitions(sequence INTEGER PRIMARY KEY, ended_at TEXT NOT NULL, body TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO acquisitions VALUES(?,?,?)');
    let sequence = 0;
    await repos.workerResults.readChangedSince(null, undefined, {
      projection: {id: true, result: ['role', 'source', 'requestCount']},
      page: async rows => {
        for (const {key, record} of rows) {
          const header = record.result;
          if (header?.role !== 'ACQUIRER' || header.requestCount <= 0 || typeof header.source?.url !== 'string') continue;
          let headerSource: string;
          try { headerSource = sourceReliabilityKey(header.source.url); } catch { continue; }
          if (headerSource !== source) continue;
          const matching = await repos.workerResults.readWhere(key, ['id'], record.id);
          for (const row of await completedWorkerResults(repos, matching)) {
            const result = row.result;
            if (result.role !== 'ACQUIRER' || result.requestCount <= 0 || sourceReliabilityKey(result.source.url) !== source) continue;
            const compact: SourceReliabilityRow = {url: result.source.url, verdict: result.verdict, endedAt: row.endedAt,
              blockerText: result.blockers.map(blocker => blocker.description), blockerCodes: result.blockers.map(blocker => blocker.code)};
            insert.run(sequence++, row.endedAt, JSON.stringify(compact));
          }
        }
      },
    });
    let current: SourceReliability | undefined;
    for (const row of db.prepare('SELECT body FROM acquisitions ORDER BY ended_at,sequence').iterate()) {
      const acquisition = JSON.parse(row.body) as SourceReliabilityRow;
      current = foldSourceReliability(current, acquisition) ?? current;
    }
    return current ? [current] : [];
  });
}
