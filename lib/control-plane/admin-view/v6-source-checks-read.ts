export const SOURCE_CHECK_PAGE_SIZE = 100;
export const SOURCE_CHECK_DAYS = 14;

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface SourceChecksView {
  readonly observedAt: string;
  readonly state: string;
  readonly next: string | null;
  readonly rows: readonly { readonly key: string; readonly name: string; readonly url: string; readonly checkedAt: string | null;
    readonly result: string; readonly nextDueAt: string | null }[];
  readonly days: readonly { readonly day: string; readonly checks: number; readonly unchanged: number; readonly unchangedShare: number | null }[];
}

function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function readSourceChecks(query: Query, state: string, after: string, now: string): Promise<SourceChecksView> {
  const [sources, days] = await Promise.all([
    query(`SELECT cache_key, source_id, url, checked_at, http_status, unchanged, next_due_at
      FROM cp_source_checks WHERE state = $1 AND cache_key > $2 ORDER BY cache_key LIMIT $3`, [state, after, SOURCE_CHECK_PAGE_SIZE + 1]),
    query(`SELECT day::text, sum(checks) AS checks, sum(unchanged) AS unchanged FROM cp_source_check_days
      WHERE state = $1 AND day >= ($2::timestamptz AT TIME ZONE 'America/New_York')::date - $3::int
        AND day <= ($2::timestamptz AT TIME ZONE 'America/New_York')::date GROUP BY day ORDER BY day DESC`, [state, now, SOURCE_CHECK_DAYS - 1]),
  ]);
  const rows = sources.slice(0, SOURCE_CHECK_PAGE_SIZE).map(row => {
    const status = Number(row.http_status);
    let name = "Source";
    try { name = new URL(String(row.url)).hostname; } catch { /* The saved URL remains available for inspection. */ }
    return { key: String(row.cache_key), name, url: String(row.url), checkedAt: timestamp(row.checked_at),
      result: row.unchanged === true ? "Unchanged without a download" : status >= 200 && status < 300 ? "Downloaded" : "Could not read",
      nextDueAt: timestamp(row.next_due_at) };
  });
  return { observedAt: now, state, rows, next: sources.length > SOURCE_CHECK_PAGE_SIZE ? rows.at(-1)!.key : null,
    days: days.map(row => { const checks = Number(row.checks), unchanged = Number(row.unchanged);
      return { day: String(row.day), checks, unchanged, unchangedShare: checks > 0 ? unchanged / checks : null }; }) };
}
