/** @freshness-reads-here Aggregate observedAt is stamped after the database read. */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getStore } from "@netlify/blobs";
import { neon } from "@neondatabase/serverless";
import { assertWriteAllowed } from "./write-guard.ts";
import { classifyReaderEventTopic, readerTopicInCode } from "./reader-event-topics.ts";

export const READER_EVENT_TYPES = ["ASK", "ZIP_VIEW", "CARD_OPEN", "CARD_VISIBLE", "ACTIVE_SCROLL", "AGENDA_VIEW", "REACTION", "BALLOT_PICK"] as const;
export type ReaderEventType = typeof READER_EVENT_TYPES[number];
export interface ReaderEventInput {
  readonly id: string;
  readonly type: ReaderEventType;
  readonly occurredAt: string;
  readonly zip?: string | null;
  readonly district?: string | null;
  readonly residencyRelation?: "HOME" | "BROWSING" | "MOVING" | "UNKNOWN";
  readonly cardId?: string | null;
  readonly cardKind?: string | null;
  readonly durationMs?: number | null;
  readonly question?: string | null;
  readonly topic?: string | null;
  readonly reaction?: string | null;
  readonly ballotPick?: { readonly contestId: string; readonly candidateIds: readonly string[]; readonly choice: "PICKED" | "UNSURE" | "BLANK" } | null;
}
export interface ReaderEventBatchInput {
  readonly batchId: string;
  /** Random browser value; stored only as a digest in this internal namespace. */
  readonly continuityKey: string;
  readonly events: readonly ReaderEventInput[];
}
export type EventPeriod = "DAY" | "WEEK";
export interface ReaderEventArchive {
  /** Immutable, create-if-absent; a retry with other content must refuse. */
  readonly put: (key: string, compressed: Uint8Array, sha256: string) => Promise<void>;
}
interface Aggregate {
  period: EventPeriod; start: string; zip: string; district: string; topic: string; type: string; events: number;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const stableId = (value: string, label: string) => {
  if (!/^[a-zA-Z0-9/_.:#=+-]+$/.test(value)) throw new Error(`READER_EVENT_INVALID_${label}`);
  return value;
};
export function eventWeek(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

/** Whitelist fields and preserve Ask words exactly as captured. */
export function prepareReaderEventBatch(input: ReaderEventBatchInput) {
  stableId(input.batchId, "BATCH_ID");
  if (!input.continuityKey || input.events.length === 0) throw new Error("READER_EVENT_INVALID_BATCH");
  const reader = digest(`reader-event:${input.continuityKey}`);
  const seen = new Set<string>();
  const events = input.events.map(event => {
    stableId(event.id, "ID");
    if (seen.has(event.id)) throw new Error("READER_EVENT_DUPLICATE_ID");
    seen.add(event.id);
    if (!READER_EVENT_TYPES.includes(event.type) || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error("READER_EVENT_INVALID_TIME_OR_TYPE");
    const zip = event.zip == null ? null : /^\d{5}$/.test(event.zip) ? event.zip : (() => { throw new Error("READER_EVENT_INVALID_ZIP"); })();
    const district = event.district == null ? null : stableId(event.district, "DISTRICT");
    const question = event.question ?? null;
    const pick = event.ballotPick == null ? null : {
      contestId: stableId(event.ballotPick.contestId, "CONTEST"),
      candidateIds: event.ballotPick.candidateIds.map(id => stableId(id, "CANDIDATE")),
      choice: event.ballotPick.choice,
    };
    if (pick && !["PICKED", "UNSURE", "BLANK"].includes(pick.choice)) throw new Error("READER_EVENT_INVALID_PICK");
    if (event.durationMs != null && (!Number.isFinite(event.durationMs) || event.durationMs < 0)) throw new Error("READER_EVENT_INVALID_DURATION");
    return {
      id: event.id, type: event.type, occurredAt: new Date(event.occurredAt).toISOString(), zip, district,
      residencyRelation: event.residencyRelation ?? "UNKNOWN",
      cardId: event.cardId == null ? null : stableId(event.cardId, "CARD"),
      cardKind: event.cardKind == null ? null : stableId(event.cardKind, "CARD_KIND"),
      durationMs: event.durationMs ?? null,
      question,
      topic: event.topic == null ? readerTopicInCode(question ?? "") ?? "free-form" : stableId(event.topic, "TOPIC"),
      reaction: event.reaction == null ? null : stableId(event.reaction, "REACTION"), ballotPick: pick,
    };
  });
  // No receiving clock enters this digest: identical retries name identical bytes.
  const body = { version: 1, batchId: input.batchId, reader, events };
  const json = JSON.stringify(body);
  const sha256 = digest(json);
  const batchId = digest(`reader-event-batch:${reader}:${input.batchId}`);
  const archiveKey = `events/${events[0]!.occurredAt.slice(0, 10)}/${batchId}.json.gz`;
  const aggregates = new Map<string, Aggregate>();
  for (const event of events) {
    const day = event.occurredAt.slice(0, 10);
    const scopes = new Map([[event.zip ?? "", event.district ?? ""], [event.zip ?? "", ""], ["", event.district ?? ""], ["", ""]].map(scope => [JSON.stringify(scope), scope]));
    for (const [period, start] of [["DAY", day], ["WEEK", eventWeek(day)]] as const) for (const [zip, district] of scopes.values()) {
      for (const [topic, type] of [[event.topic, event.type], [event.topic, "*"], ["*", event.type], ["*", "*"]]) {
        const row: Aggregate = { period, start, zip: zip!, district: district!, topic: topic!, type: type!, events: 1 };
        const key = JSON.stringify([period, start, zip, district, topic, type]);
        const previous = aggregates.get(key);
        aggregates.set(key, { ...row, events: (previous?.events ?? 0) + 1 });
      }
    }
  }
  return { body, json, sha256, reader, batchId, archiveKey, aggregates: [...aggregates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value) };
}

function netlifyEventArchive(): ReaderEventArchive {
  const store = getStore({ name: "reader-event-history", consistency: "strong" });
  return { put: async (key, bytes, sha256) => {
    const written = await store.set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { onlyIfNew: true, metadata: { sha256, encoding: "gzip", format: "reader-events-v1" } });
    if (!written.modified) {
      const prior = await store.getMetadata(key);
      if (prior?.metadata.sha256 !== sha256) throw new Error("READER_EVENT_BATCH_CONTENT_CHANGED");
    }
  } };
}

/** Full history goes to cheap immutable Blobs first; Postgres receives aggregates only. */
export async function appendReaderEvents(input: ReaderEventBatchInput, options: {
  readonly archive?: ReaderEventArchive;
  readonly query?: (statement: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  readonly classifyTopic?: (question: string) => Promise<string>;
} = {}): Promise<{ readonly kind: "RECORDED"; readonly events: number; readonly duplicate: boolean }> {
  assertWriteAllowed("reader events");
  const prepared = prepareReaderEventBatch(input);
  const archive = options.archive ?? netlifyEventArchive();
  await archive.put(prepared.archiveKey, gzipSync(prepared.json), prepared.sha256);
  // The archive/retry digest remains the exact captured input. Derived model
  // labels affect totals only, so an unavailable classifier on the first send
  // cannot make the same captured batch fail its later retry.
  const questions = new Map<string, Promise<string>>();
  const classified = await Promise.all(prepared.body.events.map(async event => {
    if (event.type !== "ASK" || event.topic !== "free-form" || !event.question) return event.topic;
    let topic = questions.get(event.question);
    if (!topic) {
      topic = (options.classifyTopic ?? classifyReaderEventTopic)(event.question).catch(() => "free-form");
      questions.set(event.question, topic);
    }
    return topic;
  }));
  const aggregates = prepareReaderEventBatch({ ...input,
    events: input.events.map((event, index) => ({ ...event, topic: classified[index]! })) }).aggregates;
  const query = options.query ?? ((statement, params) => neon(process.env.DATABASE_URL!).query(statement, [...params]));
  const result = await query(`WITH claimed AS (
    INSERT INTO reader_event_batches (batch_id, archive_key, payload_sha256, event_count)
    VALUES ($1, $2, $3, $4) ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id
  ), incoming AS (
    SELECT x.* FROM jsonb_to_recordset($5::jsonb) AS x(period text, start date, zip text, district text, topic text, type text, events bigint)
    WHERE EXISTS (SELECT 1 FROM claimed)
  ), members AS (
    INSERT INTO reader_event_members (period, period_start, zip, district, topic, event_type, reader_hash)
    SELECT period, start, zip, district, topic, type, $6 FROM incoming ORDER BY period, start, zip, district, topic, type
    ON CONFLICT DO NOTHING RETURNING period, period_start, zip, district, topic, event_type
  ), users AS (
    SELECT period, period_start, zip, district, topic, event_type, count(*) AS users FROM members
    GROUP BY period, period_start, zip, district, topic, event_type
  ), totals AS (
    INSERT INTO reader_event_totals (period, period_start, zip, district, topic, event_type, events, users)
    SELECT i.period, i.start, i.zip, i.district, i.topic, i.type, i.events, coalesce(u.users, 0)
    FROM incoming i LEFT JOIN users u ON (u.period,u.period_start,u.zip,u.district,u.topic,u.event_type) = (i.period,i.start,i.zip,i.district,i.topic,i.type)
    ORDER BY i.period, i.start, i.zip, i.district, i.topic, i.type
    ON CONFLICT (period, period_start, zip, district, topic, event_type) DO UPDATE SET
      events = reader_event_totals.events + EXCLUDED.events, users = reader_event_totals.users + EXCLUDED.users
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM claimed) AS recorded,
    (SELECT payload_sha256 FROM reader_event_batches WHERE batch_id = $1) AS previous_hash`,
    [prepared.batchId, prepared.archiveKey, prepared.sha256, prepared.body.events.length, JSON.stringify(aggregates), prepared.reader]);
  if (!result[0]?.recorded && result[0]?.previous_hash !== prepared.sha256) {
    // A concurrent insert may commit after this statement took its snapshot.
    const existing = await query("SELECT payload_sha256 FROM reader_event_batches WHERE batch_id = $1", [prepared.batchId]);
    if (existing[0]?.payload_sha256 !== prepared.sha256) throw new Error("READER_EVENT_BATCH_CONTENT_CHANGED");
  }
  return { kind: "RECORDED", events: prepared.body.events.length, duplicate: !result[0]?.recorded };
}

export interface ReaderEventTotal {
  period: EventPeriod; day: string; week: string; zip: string | null; district: string | null;
  topic: string; eventType: string; events: number; users: number; totalUsers: number;
}
export type ReaderEventTotalsRead = { kind: "RECORDED"; observedAt: string; rows: readonly ReaderEventTotal[] } | { kind: "NOT_INSTALLED"; detail: string };
/** Aggregate-only API: no ID, exact timestamp, question, pick or individual trail. */
export async function readReaderEventTotals(options: { period?: EventPeriod; days?: number; weeks?: number; limit?: number; topicsOnly?: boolean } = {}): Promise<ReaderEventTotalsRead> {
  const period = options.period ?? "DAY";
  const days = period === "WEEK" ? Math.min(104, Math.max(1, Math.trunc(options.weeks ?? 12))) * 7 : Math.min(730, Math.max(1, Math.trunc(options.days ?? 30)));
  const limit = Math.min(5000, Math.max(1, Math.trunc(options.limit ?? 500)));
  try {
    const rows = await neon(process.env.DATABASE_URL!).query(`SELECT t.period, t.period_start::text AS day,
      (t.period_start - ((extract(isodow FROM t.period_start)::int - 1)))::text AS week,
      nullif(t.zip, '') AS zip, nullif(t.district, '') AS district, t.topic, t.event_type AS "eventType",
      t.events::text, t.users::text, coalesce(d.users, 0)::text AS "totalUsers"
      FROM reader_event_totals t LEFT JOIN reader_event_totals d ON
        (d.period,d.period_start,d.zip,d.district,d.topic,d.event_type) = (t.period,t.period_start,t.zip,t.district,'*','*')
      WHERE t.period = $1 AND t.period_start >= CASE WHEN $1 = 'WEEK'
        THEN date_trunc('week', now() AT TIME ZONE 'UTC')::date - ($2::int - 6)
        ELSE (now() AT TIME ZONE 'UTC')::date - $2::int END
      ${options.topicsOnly ? "AND t.topic <> '*' AND t.event_type = '*'" : ""}
      ORDER BY t.period_start DESC, t.events DESC, t.zip, t.district, t.topic, t.event_type LIMIT $3`, [period, days - 1, limit]);
    return { kind: "RECORDED", observedAt: new Date().toISOString(), rows: rows.map(row => ({ ...row, events: Number(row.events), users: Number(row.users), totalUsers: Number(row.totalUsers) })) as ReaderEventTotal[] };
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return { kind: "NOT_INSTALLED", detail: "Reader events need migration 0034." };
    throw error;
  }
}
/** Weekly topic counts, with optional day grouping. */
export async function readTopicCounts(options: { weeks?: number; days?: number; period?: EventPeriod; limit?: number } = {}) {
  const read = await readReaderEventTotals({ ...options, period: options.period ?? "WEEK", topicsOnly: true });
  return read.kind === "NOT_INSTALLED" ? read : { ...read, rows: read.rows
    .filter(row => row.topic !== "*" && row.eventType === "*")
    .map(row => ({ period: row.day, grain: row.period === "DAY" ? "day" as const : "week" as const,
      week: row.week, zip: row.zip, district: row.district, topic: row.topic,
      events: row.events, users: row.users, totalUsers: row.totalUsers })) };
}
