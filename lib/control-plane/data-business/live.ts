/**
 * The live sources: the event store (`lib/db/reader-events.ts`) behind `Sources`.
 *
 * Cheapest first. Counts come from `reader_event_totals` (exact, no reader in them) and new-vs-returning from
 * `reader_event_members` (counted in the database; no id comes back). Only a recipe that needs a card, the residency stamp or the
 * words reads the event history: the immutable gzip batches in the `reader-event-history` blob store. Each batch is read once and
 * kept (immutable, so a cached copy is never stale), and an event is reduced to its UTC day before any recipe sees it.
 *
 * Nothing here writes. A store that is not installed answers NOT_INSTALLED, never an empty list.
 */
import { gunzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import type { CapturedEvent, CohortRow, EventType, Residency, TotalsRow } from "./types.ts";
import { EVENT_TYPES } from "./types.ts";
import { daysBefore, weekOf } from "./slice.ts";
import { liveZipPlaceIndex } from "./places.ts";
import { TOTALS_ROW_LIMIT, type CohortQuery, type Loaded, type Sources, type TotalsQuery } from "./read.ts";

export type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

const NOT_INSTALLED = "Reader events need migration 0034, so there are no counts yet. That is unknown, not zero.";
const NO_DATABASE = "No reader database is configured here, so the counts are unknown, not zero.";

/** The default query: the reader database over HTTP, or null when none is configured. */
export function readerQuery(env: NodeJS.ProcessEnv = process.env): Query | null {
  const url = env.DATABASE_URL?.trim();
  if (url === undefined || url === "") return null;
  const sql = neon(url);
  return (text, params) => sql.query(text, [...params]);
}

const isMissingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";
const grainName = (g: "day" | "week") => (g === "week" ? "WEEK" : "DAY");
const firstPeriod = (grain: "day" | "week", from: string) => (grain === "week" ? weekOf(from) : from);

/** The SQL for a totals read: one family of the store's rows, cut to the window, and the places and topics asked for. */
export function totalsSql(q: TotalsQuery, limit: number): { readonly text: string; readonly params: readonly unknown[] } {
  const params: unknown[] = [grainName(q.grain), firstPeriod(q.grain, q.from), q.to];
  const where = ["period = $1", "period_start BETWEEN $2::date AND $3::date"];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (q.family === "all") where.push("zip = ''", "district = ''");
  else if (q.family === "zip") {
    where.push("zip <> ''", "district = ''");
    if (q.zips != null) where.push(`zip = ANY(${add([...q.zips])}::text[])`);
  } else {
    where.push("zip = ''", "district <> ''");
    if (q.districts != null) where.push(`district = ANY(${add([...q.districts])}::text[])`);
    if (q.districtState != null) where.push(`district LIKE ${add(`%/state:${q.districtState}/%`)}`);
  }
  if (q.topics != null) where.push(`(topic = '*' OR topic = ANY(${add([...q.topics])}::text[]))`);
  return {
    text: `SELECT period_start::text AS period, zip, district, topic, event_type AS type, events::text AS events, users::text AS users
      FROM reader_event_totals WHERE ${where.join(" AND ")}
      ORDER BY period_start, zip, district, topic, event_type LIMIT ${Math.trunc(limit) + 1}`,
    params,
  };
}

export function liveTotals(query: Query | null = readerQuery()) {
  return async (q: TotalsQuery): Promise<Loaded<TotalsRow>> => {
    if (query === null) return { kind: "NOT_INSTALLED", detail: NO_DATABASE };
    const { text, params } = totalsSql(q, TOTALS_ROW_LIMIT);
    try {
      const rows = await query(text, params);
      return { kind: "ROWS", truncated: rows.length > TOTALS_ROW_LIMIT, rows: rows.slice(0, TOTALS_ROW_LIMIT).map((r) => ({
        grain: q.grain, period: String(r.period), zip: r.zip === "" ? null : String(r.zip), district: r.district === "" ? null : String(r.district),
        topic: String(r.topic), type: String(r.type), events: Number(r.events), users: Number(r.users) })) };
    } catch (error) {
      if (isMissingTable(error)) return { kind: "NOT_INSTALLED", detail: NOT_INSTALLED };
      throw error;
    }
  };
}

/** Distinct readers per period, and how many were never seen in an earlier period of the same group. Counted in the database. */
export function cohortsSql(q: CohortQuery): { readonly text: string; readonly params: readonly unknown[] } {
  const zip = q.family === "zip" ? q.key ?? "" : "";
  const district = q.family === "district" ? q.key ?? "" : "";
  return {
    text: `SELECT m.period_start::text AS period, count(*)::text AS readers,
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM reader_event_members p WHERE p.period = m.period AND p.zip = m.zip AND p.district = m.district
            AND p.topic = '*' AND p.event_type = '*' AND p.reader_hash = m.reader_hash AND p.period_start < m.period_start))::text AS "newReaders"
      FROM reader_event_members m
      WHERE m.period = $1 AND m.period_start BETWEEN $2::date AND $3::date AND m.zip = $4 AND m.district = $5 AND m.topic = '*' AND m.event_type = '*'
      GROUP BY m.period_start ORDER BY m.period_start`,
    params: [grainName(q.grain), firstPeriod(q.grain, q.from), q.to, zip, district],
  };
}

export function liveCohorts(query: Query | null = readerQuery()) {
  return async (q: CohortQuery): Promise<Loaded<CohortRow>> => {
    if (query === null) return { kind: "NOT_INSTALLED", detail: NO_DATABASE };
    const { text, params } = cohortsSql(q);
    try {
      const rows = await query(text, params);
      return { kind: "ROWS", rows: rows.map((r) => ({ grain: q.grain, period: String(r.period), readers: Number(r.readers), newReaders: Number(r.newReaders) })) };
    } catch (error) {
      if (isMissingTable(error)) return { kind: "NOT_INSTALLED", detail: NOT_INSTALLED };
      throw error;
    }
  };
}

/* ------------------------------------------------------------------------------------------------- the history */

/** The small part of a blob store this reads: list a day's batch keys, fetch one batch's bytes. */
export interface HistoryStore {
  readonly list: (prefix: string) => Promise<readonly string[]>;
  readonly get: (key: string) => Promise<Uint8Array | null>;
}

/** The most batches one events read will open. A wider window is refused with words, never cut short and called whole. */
export const HISTORY_BATCH_LIMIT = 4000;
const CACHE_LIMIT = 3000;
const PARALLEL = 16;

interface StoredEvent {
  readonly type?: unknown; readonly occurredAt?: unknown; readonly zip?: unknown; readonly district?: unknown; readonly residencyRelation?: unknown;
  readonly cardId?: unknown; readonly cardKind?: unknown; readonly durationMs?: unknown; readonly question?: unknown; readonly topic?: unknown;
  readonly reaction?: unknown; readonly ballotPick?: unknown; readonly tester?: unknown;
}
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const RESIDENCY: readonly Residency[] = ["HOME", "BROWSING", "MOVING", "UNKNOWN"];

/** One stored batch into events: the exact time is reduced to its UTC day here, and nothing later can see it. */
export function eventsOfBatch(json: string): CapturedEvent[] {
  const body = JSON.parse(json) as { reader?: unknown; tester?: unknown; events?: readonly StoredEvent[] };
  const reader = str(body.reader);
  if (reader === null || !Array.isArray(body.events)) return [];
  const out: CapturedEvent[] = [];
  for (const e of body.events) {
    const at = str(e.occurredAt);
    const type = (EVENT_TYPES as readonly unknown[]).includes(e.type) ? (e.type as EventType) : null;
    if (at === null || type === null || !Number.isFinite(Date.parse(at))) continue;
    const pick = e.ballotPick as CapturedEvent["ballotPick"] | null | undefined;
    out.push({
      type, day: new Date(at).toISOString().slice(0, 10), reader, zip: str(e.zip), district: str(e.district),
      residency: (RESIDENCY as readonly unknown[]).includes(e.residencyRelation) ? (e.residencyRelation as Residency) : "UNKNOWN",
      cardId: str(e.cardId), cardKind: str(e.cardKind), durationMs: typeof e.durationMs === "number" ? e.durationMs : null, text: str(e.question),
      topic: str(e.topic) ?? "free-form", reaction: str(e.reaction), ballotPick: pick ?? null, tester: e.tester === true || body.tester === true,
    });
  }
  return out;
}

/** The history source over a blob store. `cache` keeps parsed batches by key: they are immutable, so a copy is never stale. */
export function historyEvents(store: HistoryStore, cache: Map<string, CapturedEvent[]> = new Map()) {
  return async (window: { readonly from: string; readonly to: string }): Promise<Loaded<CapturedEvent>> => {
    // A batch sits under the day of its first event and can run past midnight, so the day before the window is read too.
    const keys: string[] = [];
    for (let day = daysBefore(window.from, 1); day <= window.to; day = daysBefore(day, -1)) keys.push(...await store.list(`events/${day}/`));
    if (keys.length > HISTORY_BATCH_LIMIT) return { kind: "ROWS", rows: [], truncated: true };
    const rows: CapturedEvent[] = [];
    for (let i = 0; i < keys.length; i += PARALLEL) {
      const parts = await Promise.all(keys.slice(i, i + PARALLEL).map(async (key) => {
        const held = cache.get(key);
        if (held !== undefined) return held;
        const bytes = await store.get(key);
        if (bytes === null) return [];
        const events = eventsOfBatch(gunzipSync(bytes).toString("utf8"));
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
        cache.set(key, events);
        return events;
      }));
      for (const part of parts) for (const e of part) if (e.day >= window.from && e.day <= window.to) rows.push(e);
    }
    return { kind: "ROWS", rows };
  };
}

/** The deployed history store: Netlify Blobs, opened lazily so the test and local path never load the client. */
export function netlifyHistoryStore(credentials: { readonly siteID?: string; readonly token?: string } = {}): HistoryStore {
  const open = async () => {
    const { getStore } = await import("@netlify/blobs");
    const base = { name: "reader-event-history", consistency: "strong" as const };
    return credentials.siteID && credentials.token ? getStore({ ...base, siteID: credentials.siteID, token: credentials.token }) : getStore(base);
  };
  return {
    async list(prefix) {
      const store = await open();
      const keys: string[] = [];
      for await (const page of store.list({ prefix, paginate: true })) for (const blob of page.blobs) keys.push(blob.key);
      return keys;
    },
    async get(key) {
      const data = await (await open()).get(key, { type: "arrayBuffer" });
      return data === null ? null : new Uint8Array(data);
    },
  };
}

const sharedCache = new Map<string, CapturedEvent[]>();

/** Every source, bound to the real store. Pass your own `query` or `history` to point it elsewhere (tests, scripts). */
export function liveSources(options: { readonly query?: Query | null; readonly history?: HistoryStore } = {}): Sources {
  const query = options.query === undefined ? readerQuery() : options.query;
  const events = historyEvents(options.history ?? netlifyHistoryStore(), options.history === undefined ? sharedCache : new Map());
  return { totals: liveTotals(query), cohorts: liveCohorts(query), events, places: liveZipPlaceIndex,
    populations: async keys => {
      const { populationDenominators } = await import("./population.ts");
      return populationDenominators(keys, query ? async statements => Promise.all(statements.map(statement => query(statement.text, statement.params))) : null);
    } };
}

/* ------------------------------------------------------------------------------------------ did anything fail to record */

export type CaptureFailures =
  | {
      readonly kind: "MEASURED";
      /** Batches the store holds a row for, and the events they carry. */
      readonly batchesRecorded: number;
      readonly eventsRecorded: number;
      /** Events in the store's all-day counts. Equal to `eventsRecorded` when nothing was archived and left uncounted. */
      readonly eventsCounted: number;
      /** Batches in the history store with no row in the database, over the window. Null when the history store could not be listed. */
      readonly archivedNotCounted: number | null;
      readonly archiveNote: string | null;
    }
  | { readonly kind: "NOT_INSTALLED"; readonly detail: string };

/**
 * What the server can say about events that did not make it in: batches archived but never counted (the archive is written first,
 * so a counting failure leaves a batch with no row), and a total that does not match the batches. What it cannot say is how many
 * batches a device gave up on or the capture route refused: nothing counts those, and this never reports their absence as "none".
 */
export async function readCaptureFailures(options: { readonly query?: Query | null; readonly history?: HistoryStore | null; readonly from: string; readonly to: string }): Promise<CaptureFailures> {
  const query = options.query === undefined ? readerQuery() : options.query;
  if (query === null) return { kind: "NOT_INSTALLED", detail: NO_DATABASE };
  try {
    const [recorded] = await query("SELECT count(*)::text AS batches, coalesce(sum(event_count), 0)::text AS events FROM reader_event_batches", []);
    const [counted] = await query("SELECT coalesce(sum(events), 0)::text AS events FROM reader_event_totals WHERE period = 'DAY' AND zip = '' AND district = '' AND topic = '*' AND event_type = '*'", []);
    let archivedNotCounted: number | null = null;
    let archiveNote: string | null = null;
    if (options.history === null || options.history === undefined) archiveNote = "The history store is not reachable from here, so batches archived but never counted were not checked.";
    else {
      try {
        const keys: string[] = [];
        for (let day = options.from; day <= options.to; day = daysBefore(day, -1)) keys.push(...await options.history.list(`events/${day}/`));
        const rows = await query("SELECT archive_key FROM reader_event_batches WHERE archive_key >= $1 AND archive_key < $2", [`events/${options.from}/`, `events/${daysBefore(options.to, -1)}/`]);
        const held = new Set(rows.map((r) => String(r.archive_key)));
        archivedNotCounted = keys.filter((k) => !held.has(k)).length;
      } catch {
        archiveNote = "The history store could not be listed just now, so batches archived but never counted were not checked.";
      }
    }
    return { kind: "MEASURED", batchesRecorded: Number(recorded.batches), eventsRecorded: Number(recorded.events), eventsCounted: Number(counted.events), archivedNotCounted, archiveNote };
  } catch (error) {
    if (isMissingTable(error)) return { kind: "NOT_INSTALLED", detail: NOT_INSTALLED };
    throw error;
  }
}
