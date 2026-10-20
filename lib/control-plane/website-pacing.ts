/**
 * Per-website pacing every reader shares, across work items, rounds and
 * worker processes. A small publisher's website (a local government under
 * 10,000 people, a school district under 5,000 students) takes at most its
 * hourly allowance, counted over everything sent to it. A website that answers
 * 429 or 5xx, or sends Retry-After, is left alone by every reader until then.
 * One row per website (`cp_website_pacing`); each take is one atomic statement.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../civic-data/temporary-path.ts";

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
  /** The requested site's active hold, or null. */
  heldUntil(site: string, nowMs: number): Promise<number | null>;
  /** Reserve the next send for `key`, sends `intervalMs` apart for every reader: when this one may go. */
  reserve(key: string, intervalMs: number, nowMs: number): Promise<number>;
}

function openLocalPacing() {
  const directory = mkdtempSync(join(tmpdir(), "meanwhile-website-pacing-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(temporaryPath(join(directory, "pacing.sqlite")));
  db.exec(`PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF;
    CREATE TABLE requests(sequence INTEGER PRIMARY KEY, owner INTEGER NOT NULL, site TEXT NOT NULL, at REAL NOT NULL);
    CREATE INDEX requests_site ON requests(owner,site,at);
    CREATE TABLE sites(owner INTEGER NOT NULL, site TEXT NOT NULL, hold_until REAL, paced_until REAL, PRIMARY KEY(owner,site));`);
  return {db, directory,
    expire: db.prepare("DELETE FROM requests WHERE owner=? AND site=? AND at<=?"),
    count: db.prepare("SELECT count(*) AS count FROM requests WHERE owner=? AND site=?"),
    oldest: db.prepare("SELECT at FROM requests WHERE owner=? AND site=? ORDER BY sequence LIMIT 1"),
    take: db.prepare("INSERT INTO requests(owner,site,at) VALUES(?,?,?)"),
    hold: db.prepare(`INSERT INTO sites(owner,site,hold_until) VALUES(?,?,?)
      ON CONFLICT(owner,site) DO UPDATE SET hold_until=MAX(COALESCE(sites.hold_until,excluded.hold_until),excluded.hold_until)`),
    held: db.prepare("SELECT hold_until FROM sites WHERE owner=? AND site=? AND hold_until>?"),
    reserve: db.prepare(`INSERT INTO sites(owner,site,paced_until) VALUES(?,?,?+?)
      ON CONFLICT(owner,site) DO UPDATE SET paced_until=MAX(COALESCE(sites.paced_until,?),?)+? RETURNING paced_until`),
    forgetRequests: db.prepare("DELETE FROM requests WHERE owner=?"),
    forgetSites: db.prepare("DELETE FROM sites WHERE owner=?"),
  };
}
let localPacing: ReturnType<typeof openLocalPacing> | null = null;
let nextLocalOwner = 0;
const localPacingOwners = new FinalizationRegistry<number>(owner => {
  localPacing?.forgetRequests.run(owner);
  localPacing?.forgetSites.run(owner);
});
process.once("exit", () => {
  if (!localPacing) return;
  localPacing.db.close();
  rmSync(temporaryPath(localPacing.directory), {recursive: true, force: true});
  localPacing = null;
});

/** Process-local pacing, including tests and the file store. Host state stays in scratch storage with a fixed page cache. */
export function memoryWebsitePacing(): WebsitePacing {
  const owner = nextLocalOwner++;
  const database = () => localPacing ??= openLocalPacing();
  const pacing: WebsitePacing = {
    async take(site, limit, nowMs) {
      const db = database();
      db.expire.run(owner, site, nowMs - WEBSITE_WINDOW_MS);
      if (Number(db.count.get(owner, site)?.count) >= limit)
        return {ok: false, until: Number(db.oldest.get(owner, site)?.at) + WEBSITE_WINDOW_MS};
      db.take.run(owner, site, nowMs);
      return { ok: true };
    },
    async hold(site, until) {
      database().hold.run(owner, site, until);
    },
    async heldUntil(site, nowMs) {
      const held = localPacing?.held.get(owner, site, nowMs)?.hold_until;
      return typeof held === "number" ? held : null;
    },
    async reserve(key, intervalMs, nowMs) {
      return Number(database().reserve.get(owner, key, nowMs, intervalMs, nowMs, nowMs, intervalMs)?.paced_until) - intervalMs;
    },
  };
  localPacingOwners.register(pacing, owner);
  return pacing;
}

export const WEBSITE_PACING_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_website_pacing (
  site text PRIMARY KEY,
  requests timestamptz[] NOT NULL DEFAULT '{}',
  hold_until timestamptz,
  updated_at timestamptz NOT NULL
);`,
  "CREATE INDEX IF NOT EXISTS cp_website_pacing_held ON cp_website_pacing (hold_until) WHERE hold_until IS NOT NULL;",
  "ALTER TABLE cp_website_pacing ADD COLUMN IF NOT EXISTS paced_until timestamptz;",
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
/** The row's next free send, moved one interval on: two readers in two processes never get the same send. */
const WEBSITE_RESERVE_SQL = `INSERT INTO cp_website_pacing AS p (site, paced_until, updated_at) VALUES ($1, $2::timestamptz + $3::double precision * interval '1 millisecond', $2::timestamptz)
ON CONFLICT (site) DO UPDATE SET paced_until = GREATEST(COALESCE(p.paced_until, $2::timestamptz), $2::timestamptz) + $3::double precision * interval '1 millisecond', updated_at = $2::timestamptz
RETURNING paced_until`;
export const WEBSITE_HELD_SQL = "SELECT hold_until FROM cp_website_pacing WHERE site=$1 AND hold_until>$2::timestamptz";

type Query = (text: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

const iso = (ms: number): string => new Date(ms).toISOString();
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value)));

/** How long a website that answered 429 or 5xx without a Retry-After is left alone. */
export const WEBSITE_BACKOFF_MS = 60_000;

export type WebsiteAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly until: number; readonly why: "ASKED_TO_WAIT" | "HOURLY_ALLOWANCE" };

/** One request a reader is about to send: a held website waits for every reader; a small one takes from its shared hour. */
export async function admitWebsiteRequest(pacing: WebsitePacing, url: string, limit: number | null, nowMs: number): Promise<WebsiteAdmission> {
  const site = websiteOf(url);
  const held = await pacing.heldUntil(site, nowMs);
  if (held !== null && held > nowMs) return { ok: false, until: held, why: "ASKED_TO_WAIT" };
  if (limit === null) return { ok: true };
  const took = await pacing.take(site, limit, nowMs);
  return took.ok ? took : { ok: false, until: took.until, why: "HOURLY_ALLOWANCE" };
}

/** A Retry-After value (seconds or an HTTP date) as milliseconds from `nowMs`; null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** What a website's answer means for every reader: a 429 or 5xx holds it until its Retry-After, or for a minute. The hold, or null. */
export async function holdWebsiteAfter(pacing: WebsitePacing, url: string, status: number, retryAfter: string | null | undefined, nowMs: number): Promise<number | null> {
  if (status !== 429 && status < 500) return null;
  const until = nowMs + Math.max(WEBSITE_BACKOFF_MS, retryAfterMs(retryAfter, nowMs) ?? 0);
  await pacing.hold(websiteOf(url), until, nowMs);
  return until;
}

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
    async heldUntil(site, nowMs) {
      const held = (await query(WEBSITE_HELD_SQL, [site, iso(nowMs)]))[0]?.hold_until;
      return held == null ? null : ms(held);
    },
    async reserve(key, intervalMs, nowMs) {
      return ms((await query(WEBSITE_RESERVE_SQL, [key, iso(nowMs), intervalMs]))[0]?.paced_until) - intervalMs;
    },
  };
}
