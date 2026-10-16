import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createWebsitePacing, WEBSITE_WINDOW_MS, type WebsitePacing } from "../control-plane/website-pacing.ts";

export interface SavedSourceResponse {
  readonly checkKey: string;
  readonly checkedAt: string; readonly checkStatus: number; readonly status: number; readonly headers: readonly [string, string][];
  readonly finalUrl: string; readonly rawHash: string; readonly byteCount: number;
  readonly vaultKey: string; readonly chunks: readonly string[];
}
export interface SourceCheck {
  readonly sourceId: string; readonly state: string; readonly url: string;
  readonly checkedAt: string; readonly httpStatus: number; readonly unchanged: boolean;
  readonly downloadedBytes: number; readonly nextDueAt?: string;
  readonly reused?: boolean;
}
export interface SourcePrefetchRequest {
  readonly url: string; readonly headers: readonly [string, string][]; readonly redirect: RequestRedirect;
  readonly byteCount: number; readonly spacingMs?: number;
}
export interface SourceRequestPlan {
  readonly calendar: readonly SourcePrefetchRequest[];
  readonly documents: Readonly<Record<string, readonly SourcePrefetchRequest[]>>;
}
export interface SourceFetchStore {
  readonly pacing: WebsitePacing;
  withLease<T>(key: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  read(key: string): Promise<SavedSourceResponse | null>;
  readRequestPlan(state: string, sourceId: string): Promise<SourceRequestPlan | null>;
  saveRequestGroup(state: string, sourceId: string, kind: "CALENDAR" | "DOCUMENT", targetUrl: string | null, requests: readonly SourcePrefetchRequest[]): Promise<void>;
  record(key: string, value: SavedSourceResponse | null, check: SourceCheck, aliases?: readonly string[]): Promise<void>;
}

export const SOURCE_FETCH_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_source_responses (
    cache_key text PRIMARY KEY, value jsonb, lease_token text, lease_until timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS cp_source_requests (
    state text NOT NULL, source_id text NOT NULL, request jsonb NOT NULL, PRIMARY KEY (state,source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cp_source_checks (
    cache_key text PRIMARY KEY, source_id text NOT NULL, state text NOT NULL, url text NOT NULL,
    checked_at timestamptz NOT NULL, http_status integer NOT NULL, unchanged boolean NOT NULL,
    next_due_at timestamptz
  )`,
  "CREATE INDEX IF NOT EXISTS cp_source_checks_state_key ON cp_source_checks (state, cache_key)",
  "CREATE INDEX IF NOT EXISTS cp_source_checks_source ON cp_source_checks (source_id)",
  `CREATE TABLE IF NOT EXISTS cp_source_check_days (
    state text NOT NULL, day date NOT NULL, source_id text NOT NULL, checks bigint NOT NULL DEFAULT 0,
    unchanged bigint NOT NULL DEFAULT 0, downloaded_bytes bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (state, day, source_id)
  )`,
] as const;

type Query = (text: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export function postgresSourceFetchStore(query: Query): SourceFetchStore {
  return {
    pacing: createWebsitePacing(query),
    async withLease(key, operation, signal) {
      const token = randomUUID();
      for (;;) {
        signal?.throwIfAborted();
        const rows = await query(`INSERT INTO cp_source_responses (cache_key,lease_token,lease_until) VALUES ($1,$2,now()+interval '4 minutes')
          ON CONFLICT (cache_key) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
          WHERE cp_source_responses.lease_until IS NULL OR cp_source_responses.lease_until < now() RETURNING cache_key`, [key, token]);
        if (rows.length) break;
        await sleep(100, undefined, { signal });
      }
      try { return await operation(); }
      finally { await query("UPDATE cp_source_responses SET lease_token=NULL,lease_until=NULL WHERE cache_key=$1 AND lease_token=$2", [key, token]); }
    },
    async read(key) {
      const row = (await query("SELECT value FROM cp_source_responses WHERE cache_key = $1", [key]))[0];
      return row?.value as SavedSourceResponse | null ?? null;
    },
    async readRequestPlan(state, sourceId) {
      const row = (await query("SELECT request FROM cp_source_requests WHERE state=$1 AND source_id=$2", [state, sourceId]))[0];
      return requestPlan(row?.request);
    },
    async saveRequestGroup(state, sourceId, kind, targetUrl, requests) {
      const empty = { calendar: [], documents: {} };
      const path = kind === "CALENDAR" ? ["calendar"] : ["documents", targetUrl!];
      const initial = kind === "CALENDAR" ? { ...empty, calendar: requests } : { ...empty, documents: { [targetUrl!]: requests } };
      await query(`INSERT INTO cp_source_requests (state,source_id,request) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (state,source_id) DO UPDATE SET request=jsonb_set(cp_source_requests.request,$4::text[],$5::jsonb,true)`,
      [state, sourceId, JSON.stringify(initial), path, JSON.stringify(requests)]);
    },
    async record(key, value, check, aliases = []) {
      await query(`WITH previous AS (
        SELECT checked_at,http_status FROM cp_source_checks WHERE cache_key=$1
      ), response AS (
        INSERT INTO cp_source_responses (cache_key,value) SELECT unnest($11::text[]),$9::jsonb WHERE $9::jsonb IS NOT NULL
        ON CONFLICT (cache_key) DO UPDATE SET value=EXCLUDED.value
      ), saved AS (
        INSERT INTO cp_source_checks AS s (cache_key,source_id,state,url,checked_at,http_status,unchanged,next_due_at)
        VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$7,$8::timestamptz)
        ON CONFLICT (cache_key) DO UPDATE SET source_id=EXCLUDED.source_id,state=EXCLUDED.state,url=EXCLUDED.url,
          checked_at=EXCLUDED.checked_at,http_status=EXCLUDED.http_status,unchanged=EXCLUDED.unchanged,
          next_due_at=COALESCE(EXCLUDED.next_due_at,s.next_due_at)
        RETURNING state
      ) INSERT INTO cp_source_check_days AS d (state,day,source_id,checks,unchanged,downloaded_bytes)
        SELECT state,($5::timestamptz AT TIME ZONE 'America/New_York')::date,$2,1,CASE WHEN $7 THEN 1 ELSE 0 END,$10 FROM saved
        WHERE NOT ($12::boolean AND EXISTS (SELECT 1 FROM previous WHERE checked_at=$5::timestamptz AND http_status=$6))
        ON CONFLICT (state,day,source_id) DO UPDATE SET checks=d.checks+1,
          unchanged=d.unchanged+EXCLUDED.unchanged,downloaded_bytes=d.downloaded_bytes+EXCLUDED.downloaded_bytes`,
      [keyFor(`${check.state}\n${check.sourceId}\n${key}`),check.sourceId,check.state,check.url,check.checkedAt,check.httpStatus,check.unchanged,check.nextDueAt ?? null,value ? JSON.stringify(value) : null,check.downloadedBytes,[...new Set([key, ...aliases])],check.reused ?? false]);
    },
  };
}

const keyFor = (value: string) => createHash("sha256").update(value).digest("hex");
function requestPlan(value: unknown): SourceRequestPlan | null {
  const plan = value as SourceRequestPlan | null;
  return plan && Array.isArray(plan.calendar) && plan.documents && typeof plan.documents === "object" && !Array.isArray(plan.documents) ? plan : null;
}
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
type SqlValue = string | number | null;
interface FileDatabase {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...values: SqlValue[]): { changes: number | bigint };
    get(...values: SqlValue[]): Record<string, SqlValue> | undefined;
  };
}

export function fileSourceFetchStore(namespace: string): SourceFetchStore {
  mkdirSync(join(tmpdir(), "meanwhile-source-fetch"), { recursive: true });
  const file = join(tmpdir(), "meanwhile-source-fetch", `${keyFor(namespace)}.sqlite`);
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new(path: string) => FileDatabase };
  const withDatabase = <T>(operation: (database: FileDatabase) => T): T => {
    const database = new DatabaseSync(file);
    try {
      database.exec("PRAGMA busy_timeout=5000; PRAGMA cache_size=-2048");
      return operation(database);
    } finally { database.close(); }
  };
  withDatabase(database => database.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, value TEXT, lease_token TEXT, lease_until INTEGER);
    CREATE TABLE IF NOT EXISTS hosts (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checks (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (state TEXT NOT NULL, source_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(state,source_id));
    CREATE TABLE IF NOT EXISTS days (key TEXT PRIMARY KEY, checks INTEGER NOT NULL, unchanged INTEGER NOT NULL, downloaded_bytes INTEGER NOT NULL);`));
  type Host = { requests: number[]; hold: number; paced: number };
  const mutateHost = async <T>(site: string, operation: (value: Host) => T): Promise<T> => withDatabase(database => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const held = database.prepare("SELECT value FROM hosts WHERE key=?").get(site);
      const value: Host = held ? JSON.parse(String(held.value)) : { requests: [], hold: 0, paced: 0 };
      const result = operation(value);
      database.prepare("INSERT INTO hosts VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(site, JSON.stringify(value));
      database.exec("COMMIT");
      return result;
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  });
  const pacing: WebsitePacing = {
    take: (site, limit, now) => mutateHost(site, value => {
      value.requests = value.requests.filter(at => at > now - WEBSITE_WINDOW_MS);
      if (value.requests.length >= limit) return { ok: false as const, until: value.requests[0]! + WEBSITE_WINDOW_MS };
      value.requests.push(now);
      return { ok: true as const };
    }),
    hold: (site, until) => mutateHost(site, value => { value.hold = Math.max(value.hold, until); }),
    heldUntil: async (now, site) => {
      if (!site) throw new Error("Source fetch pacing requires one website");
      const held = withDatabase(database => database.prepare("SELECT value FROM hosts WHERE key=?").get(site));
      const value: Host | null = held ? JSON.parse(String(held.value)) : null;
      return new Map(value && value.hold > now ? [[site, value.hold]] : []);
    },
    reserve: (site, interval, now) => mutateHost(site, value => {
      const at = Math.max(now, value.paced); value.paced = at + interval; return at;
    }),
  };
  return {
    pacing,
    async withLease(key, operation, signal) {
      const token = randomUUID();
      for (;;) {
        signal?.throwIfAborted();
        const claimed = withDatabase(database => database.prepare(`INSERT INTO responses (key,lease_token,lease_until) VALUES (?,?,?)
          ON CONFLICT(key) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until
          WHERE responses.lease_until IS NULL OR responses.lease_until < ?`).run(key, token, Date.now() + 240_000, Date.now()).changes);
        if (claimed) break;
        await sleep(100, undefined, { signal });
      }
      try { return await operation(); }
      finally { withDatabase(database => database.prepare("UPDATE responses SET lease_token=NULL,lease_until=NULL WHERE key=? AND lease_token=?").run(key, token)); }
    },
    async read(key) {
      const row = withDatabase(database => database.prepare("SELECT value FROM responses WHERE key=?").get(key));
      return row?.value ? JSON.parse(String(row.value)) as SavedSourceResponse : null;
    },
    async readRequestPlan(state, sourceId) {
      const row = withDatabase(database => database.prepare("SELECT value FROM requests WHERE state=? AND source_id=?").get(state, sourceId));
      return row?.value ? requestPlan(JSON.parse(String(row.value))) : null;
    },
    async saveRequestGroup(state, sourceId, kind, targetUrl, requests) {
      withDatabase(database => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const row = database.prepare("SELECT value FROM requests WHERE state=? AND source_id=?").get(state, sourceId);
          const previous = row?.value ? requestPlan(JSON.parse(String(row.value))) : null;
          const plan = previous ?? { calendar: [], documents: {} };
          const next = kind === "CALENDAR" ? { ...plan, calendar: requests } : { ...plan, documents: { ...plan.documents, [targetUrl!]: requests } };
          database.prepare("INSERT INTO requests VALUES (?,?,?) ON CONFLICT(state,source_id) DO UPDATE SET value=excluded.value")
            .run(state, sourceId, JSON.stringify(next));
          database.exec("COMMIT");
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      });
    },
    async record(key, value, check, aliases = []) {
      const dayStamp = easternDay.format(new Date(check.checkedAt));
      withDatabase(database => {
        database.exec("BEGIN IMMEDIATE");
        try {
          const checkKey = keyFor(`${check.state}\n${check.sourceId}\n${key}`);
          const held = database.prepare("SELECT value FROM checks WHERE key=?").get(checkKey);
          const previous = held ? JSON.parse(String(held.value)) as SourceCheck : null;
          const counted = !check.reused || previous?.checkedAt !== check.checkedAt || previous.httpStatus !== check.httpStatus;
          if (value) {
            const save = database.prepare("INSERT INTO responses (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
            for (const responseKey of new Set([key, ...aliases])) save.run(responseKey, JSON.stringify(value));
          }
          database.prepare("INSERT INTO checks VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
            .run(checkKey, JSON.stringify(check));
          if (counted) database.prepare(`INSERT INTO days VALUES (?,1,?,?) ON CONFLICT(key) DO UPDATE SET
            checks=days.checks+1,unchanged=days.unchanged+excluded.unchanged,downloaded_bytes=days.downloaded_bytes+excluded.downloaded_bytes`)
            .run(`${check.state}-${dayStamp}-${keyFor(check.sourceId)}`, Number(check.unchanged), check.downloadedBytes);
          database.exec("COMMIT");
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      });
    },
  };
}

let defaultStore: SourceFetchStore | undefined;
export async function defaultSourceFetchStore(): Promise<SourceFetchStore> {
  if (defaultStore) return defaultStore;
  const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (connection) {
    const { neon } = await import("@neondatabase/serverless"), sql = neon(connection);
    defaultStore = postgresSourceFetchStore(async (text, parameters) => await sql.query(text, [...parameters]) as Record<string, unknown>[]);
  } else defaultStore = fileSourceFetchStore(process.cwd());
  return defaultStore;
}
