/**
 * Per-website pacing every reader shares, across work items, rounds and
 * worker processes. A small publisher's website (a local government under
 * 10,000 people, a school district under 5,000 students) takes at most its
 * hourly allowance, counted over everything sent to it. A website that answers
 * 429 or 5xx, or sends Retry-After, is left alone by every reader until then.
 * One row per website (`cp_website_pacing`); each take is one atomic statement.
 */

export const WEBSITE_WINDOW_MS = 3_600_000;

/** One website, however it is addressed: its host without a leading www. */
export function websiteOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export type WebsiteTake = { readonly ok: true } | { readonly ok: false; readonly until: number };

export interface WebsitePacing {
  /** Take one of the site's requests for the last hour, or say when the next one is allowed. */
  take(site: string, limit: number, nowMs: number): Promise<WebsiteTake>;
  /** Leave the site alone until `until`; a later hold already in place stands. */
  hold(site: string, until: number, nowMs: number): Promise<void>;
  /** The sites held at `nowMs`, with when each may be asked again. */
  heldUntil(nowMs: number): Promise<ReadonlyMap<string, number>>;
}

/** Pacing held in this process: tests, the file store, and a reader with no shared store. */
export function memoryWebsitePacing(): WebsitePacing {
  const requests = new Map<string, number[]>();
  const holds = new Map<string, number>();
  return {
    async take(site, limit, nowMs) {
      const recent = (requests.get(site) ?? []).filter((at) => nowMs - at < WEBSITE_WINDOW_MS);
      if (recent.length >= limit) {
        requests.set(site, recent);
        return { ok: false, until: recent[0]! + WEBSITE_WINDOW_MS };
      }
      requests.set(site, [...recent, nowMs]);
      return { ok: true };
    },
    async hold(site, until) {
      holds.set(site, Math.max(holds.get(site) ?? 0, until));
    },
    async heldUntil(nowMs) {
      return new Map([...holds].filter(([, until]) => until > nowMs));
    },
  };
}

export const WEBSITE_PACING_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_website_pacing (
  site text PRIMARY KEY,
  requests timestamptz[] NOT NULL DEFAULT '{}',
  hold_until timestamptz,
  updated_at timestamptz NOT NULL
);`,
  "CREATE INDEX IF NOT EXISTS cp_website_pacing_held ON cp_website_pacing (hold_until) WHERE hold_until IS NOT NULL;",
];

/** Under the row lock the upsert takes, so two readers in two processes can never both take the last request. */
export const WEBSITE_TAKE_SQL = `INSERT INTO cp_website_pacing AS p (site, requests, updated_at) VALUES ($1, ARRAY[$3::timestamptz], $3::timestamptz)
ON CONFLICT (site) DO UPDATE SET
  requests = array_append(ARRAY(SELECT t FROM unnest(p.requests) t WHERE t > $2::timestamptz ORDER BY t), $3::timestamptz),
  updated_at = $3::timestamptz
WHERE cardinality(ARRAY(SELECT t FROM unnest(p.requests) t WHERE t > $2::timestamptz)) < $4
RETURNING site`;
const WEBSITE_OLDEST_SQL = `SELECT min(t) AS oldest FROM cp_website_pacing p, unnest(p.requests) t WHERE p.site = $1 AND t > $2::timestamptz`;
const WEBSITE_HOLD_SQL = `INSERT INTO cp_website_pacing AS p (site, hold_until, updated_at) VALUES ($1, $2::timestamptz, $3::timestamptz)
ON CONFLICT (site) DO UPDATE SET hold_until = GREATEST(COALESCE(p.hold_until, $2::timestamptz), $2::timestamptz), updated_at = $3::timestamptz`;
const WEBSITE_HELD_SQL = "SELECT site, hold_until FROM cp_website_pacing WHERE hold_until > $1::timestamptz";

type Query = (text: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

const iso = (ms: number): string => new Date(ms).toISOString();
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));

export function createWebsitePacing(query: Query): WebsitePacing {
  return {
    async take(site, limit, nowMs) {
      const since = iso(nowMs - WEBSITE_WINDOW_MS);
      if ((await query(WEBSITE_TAKE_SQL, [site, since, iso(nowMs), limit])).length > 0) return { ok: true };
      const oldest = (await query(WEBSITE_OLDEST_SQL, [site, since]))[0]?.oldest;
      return { ok: false, until: oldest == null ? nowMs + WEBSITE_WINDOW_MS : ms(oldest) + WEBSITE_WINDOW_MS };
    },
    async hold(site, until, nowMs) {
      await query(WEBSITE_HOLD_SQL, [site, iso(until), iso(nowMs)]);
    },
    async heldUntil(nowMs) {
      return new Map((await query(WEBSITE_HELD_SQL, [iso(nowMs)])).map((row) => [String(row.site), ms(row.hold_until)] as const));
    },
  };
}
