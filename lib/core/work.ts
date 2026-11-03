import { createHash, randomUUID } from "node:crypto";
import { neon } from "../db/client.ts";
import type { Query } from "../facts/publish.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { registryJurisdictions, REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { WORK_KINDS, WORK_TIERS, type OrderStep, type WorkKind, type WorkStatus, type WorkTier } from "./work-kinds.ts";
import type { StoredCapability, Unlock } from "./capability.ts";

/** Why the row exists: Sean's order, a reader's request, an Ask question, or the code that planned it. */
export type WorkOrigin =
  | { readonly from: "order"; readonly orderId: string }
  | { readonly from: "demand"; readonly subjectType: string; readonly presses: number }
  | { readonly from: "ask"; readonly questionId: string }
  | { readonly from: "planner" | "loader" | "detective"; readonly workId?: string };

export interface WorkInput {
  readonly kind: WorkKind;
  readonly tier?: WorkTier;
  readonly state?: string;
  readonly placeId: string;
  readonly subjectId: string;
  readonly url?: string | null;
  /** Absent for a link. A claim's field identifies its slot independently of its value. */
  readonly field?: string;
  /** Stable identity within a multivalued field, such as the seat in a membership claim. */
  readonly claimKey?: string;
  readonly value?: unknown;
  readonly quote?: string | null;
  readonly sources?: readonly string[];
  /** A report is a note, separate from the shared source references. */
  readonly source: Readonly<Record<string, unknown>>;
  /** Within its tier; higher is served first. */
  readonly priority?: number;
  readonly origin: WorkOrigin;
  /** Rows of one repeating job or one blank share a series; only one of them is ever live. */
  readonly series?: string;
  readonly dueAt?: string;
}

export interface WorkRow {
  readonly id: string;
  readonly kind: WorkKind;
  readonly tier: WorkTier;
  readonly priority: number;
  /** Postal state; national work uses US. */
  readonly state: string;
  readonly status: WorkStatus;
  readonly placeId: string | null;
  readonly subjectId: string | null;
  readonly field: string | null;
  readonly url: string | null;
  readonly sources: readonly string[];
  readonly reports: readonly Readonly<Record<string, unknown>>[];
  readonly value: unknown;
  readonly quote: string | null;
  readonly dueAt: string;
  readonly leaseUntil: string | null;
  readonly leaseOwner: string | null;
  readonly attempts: number;
  readonly refusal: string | null;
  readonly origin: Readonly<Record<string, unknown>>;
  readonly steps: readonly OrderStep[];
  readonly series: string | null;
  readonly receivedAt: string;
  readonly doneAt: string | null;
  readonly contentVersion: number;
  readonly leaseVersion: number | null;
}

const TIER_RANK = (tier: WorkTier): number => WORK_TIERS.indexOf(tier);
const IN_TIER_ORDER = (a: WorkRow, b: WorkRow): number => TIER_RANK(a.tier) - TIER_RANK(b.tier) || b.priority - a.priority || a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);

/** What a claim may be narrowed to. */
export interface ClaimWhere {
  readonly subjectPrefix?: string;
  readonly state?: string;
  /** Only rows a plain-code worker can do: no paid model is needed. */
  readonly plainOnly?: boolean;
  /** Only the links on this kind of website; the row's value names it. */
  readonly platform?: string;
  /** Only links that name no kind of website: pages on a government's own site. */
  readonly untagged?: boolean;
  /** Only rows filed under this government or one of its boards. */
  readonly government?: string;
}

/** The work table, its claim indexes and its waiting counts. Applied by bootstrap and by the SPN-01B migration. */
/** The column that holds a hunt's work item, task, lease and attempts on its own row; added after the table, so it is its own statement. */
export const WORK_RUN_DDL = [`ALTER TABLE work ADD COLUMN IF NOT EXISTS run jsonb NOT NULL DEFAULT '{}'::jsonb`] as const;

export const WORK_DDL = [
  `CREATE OR REPLACE FUNCTION work_tier_rank(tier text) RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE tier WHEN 'clock' THEN 0 WHEN 'order' THEN 1 WHEN 'reader' THEN 2 ELSE 3 END::smallint $$`,
  `CREATE TABLE IF NOT EXISTS work (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN (${WORK_KINDS.map(kind => `'${kind}'`).join(",")})),
    tier text NOT NULL DEFAULT 'coverage' CHECK (tier IN (${WORK_TIERS.map(tier => `'${tier}'`).join(",")})),
    priority integer NOT NULL DEFAULT 0,
    state char(2) NOT NULL,
    place_id text,
    subject_id text,
    field text,
    url text,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources)='array'),
    reports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reports)='array'),
    value jsonb NOT NULL DEFAULT 'null'::jsonb,
    quote text,
    due_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_owner text,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
    status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','taken','done','refused')),
    refusal text,
    origin jsonb NOT NULL DEFAULT '{}'::jsonb,
    steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps)='array'),
    series text,
    repeat_ms bigint CHECK (repeat_ms>0),
    content_version integer NOT NULL DEFAULT 1,
    lease_version integer,
    received_at timestamptz NOT NULL DEFAULT now(),
    done_at timestamptz,
    done_times timestamptz[] NOT NULL DEFAULT '{}',
    refused_times timestamptz[] NOT NULL DEFAULT '{}',
    unlock jsonb,
    dead_since timestamptz,
    reopened jsonb,
    CHECK ((lease_until IS NULL) = (lease_owner IS NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS work_claim ON work (kind, work_tier_rank(tier), priority DESC, due_at, id) WHERE status = 'waiting'`,
  `CREATE INDEX IF NOT EXISTS work_claim_state ON work (kind, state, work_tier_rank(tier), priority DESC, due_at, id) WHERE status = 'waiting'`,
  `CREATE INDEX IF NOT EXISTS work_expired ON work (lease_until, id) WHERE status = 'taken'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_series_live ON work (series) WHERE series IS NOT NULL AND status IN ('waiting','taken')`,
  `CREATE INDEX IF NOT EXISTS work_repeat_due ON work (done_at, id) WHERE status = 'done' AND repeat_ms IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS work_done_old ON work (done_at, id) WHERE status = 'done' AND repeat_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS work_reader_live ON work (priority DESC, received_at) WHERE tier = 'reader' AND status IN ('waiting','taken')`,
  `CREATE INDEX IF NOT EXISTS work_dead_end ON work (dead_since, id) WHERE dead_since IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS work_reopened ON work ((reopened->>'at') DESC) WHERE reopened IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS work_oldest_waiting ON work (state, kind, due_at) WHERE status = 'waiting'`,
  `CREATE INDEX IF NOT EXISTS work_oldest_refused ON work (state, kind, due_at) WHERE status = 'refused'`,
  `CREATE TABLE IF NOT EXISTS count_hour (
    state char(2) NOT NULL,
    hour timestamptz NOT NULL,
    step text NOT NULL,
    n bigint NOT NULL DEFAULT 0 CHECK (n>=0),
    PRIMARY KEY (state,hour,step)
  )`,
  // The hourly rows in, done and refused for each state.
  `CREATE OR REPLACE FUNCTION count_work_events() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE event text;
  BEGIN
    IF TG_OP = 'INSERT' THEN event := 'work_in';
    ELSIF NEW.status = 'done' THEN event := 'work_done';
    ELSIF NEW.status = 'refused' THEN event := 'work_refused';
    ELSE RETURN NEW;
    END IF;
    INSERT INTO count_hour(state, hour, step, n)
      VALUES(NEW.state, date_trunc('hour', coalesce(CASE event WHEN 'work_in' THEN NEW.received_at
        WHEN 'work_done' THEN NEW.done_times[cardinality(NEW.done_times)] ELSE NEW.refused_times[cardinality(NEW.refused_times)] END, statement_timestamp())), event, 1)
      ON CONFLICT (state, hour, step) DO UPDATE SET n = count_hour.n + 1;
    RETURN NEW;
  END $$`,
  `CREATE OR REPLACE TRIGGER work_counts_in AFTER INSERT ON work FOR EACH ROW EXECUTE FUNCTION count_work_events()`,
  `CREATE OR REPLACE TRIGGER work_counts_changed AFTER UPDATE ON work FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION count_work_events()`,
  `CREATE TABLE IF NOT EXISTS work_waiting (
    kind text NOT NULL,
    tier text NOT NULL,
    n bigint NOT NULL DEFAULT 0,
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, tier)
  )`,
  // One small write per statement, whatever the number of rows it moved.
  `CREATE OR REPLACE FUNCTION work_waiting_count() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO work_waiting(kind,tier,n,changed_at)
      SELECT kind,tier,count(*),clock_timestamp() FROM new_rows WHERE status='waiting' GROUP BY kind,tier ORDER BY kind,tier
      ON CONFLICT (kind,tier) DO UPDATE SET n=work_waiting.n+EXCLUDED.n,changed_at=EXCLUDED.changed_at;
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO work_waiting(kind,tier,n,changed_at)
      SELECT kind,tier,-count(*),clock_timestamp() FROM old_rows WHERE status='waiting' GROUP BY kind,tier ORDER BY kind,tier
      ON CONFLICT (kind,tier) DO UPDATE SET n=work_waiting.n+EXCLUDED.n,changed_at=EXCLUDED.changed_at;
    ELSE
      INSERT INTO work_waiting(kind,tier,n,changed_at)
      SELECT kind,tier,sum(moved),clock_timestamp() FROM (
        SELECT kind,tier,count(*) AS moved FROM new_rows WHERE status='waiting' GROUP BY kind,tier
        UNION ALL SELECT kind,tier,-count(*) FROM old_rows WHERE status='waiting' GROUP BY kind,tier
      ) moves GROUP BY kind,tier HAVING sum(moved)<>0 ORDER BY kind,tier
      ON CONFLICT (kind,tier) DO UPDATE SET n=work_waiting.n+EXCLUDED.n,changed_at=EXCLUDED.changed_at;
    END IF;
    RETURN NULL;
  END $$`,
  `CREATE OR REPLACE TRIGGER work_waiting_insert AFTER INSERT ON work REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION work_waiting_count()`,
  `CREATE OR REPLACE TRIGGER work_waiting_update AFTER UPDATE ON work REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION work_waiting_count()`,
  `CREATE OR REPLACE TRIGGER work_waiting_delete AFTER DELETE ON work REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION work_waiting_count()`,
] as const;

/** Links wait for the reader of their kind of website: one index serves each kind's claim in tier order, newest first. Applied by bootstrap and by the SPN-01F migration. */
export const LEAD_DDL = [
  `CREATE INDEX IF NOT EXISTS work_lead_claim ON work ((value->>'platform'), work_tier_rank(tier), priority DESC, due_at, id) WHERE kind = 'lead' AND status = 'waiting'`,
] as const;

/** A government's own pages are claimed by the government they were found under, so its walk never reads past other governments' links. Applied by bootstrap and by the SPN-01P2 migration. */
export const LEAD_GOVERNMENT_DDL = [
  `CREATE INDEX IF NOT EXISTS work_lead_government ON work ((subject_id COLLATE "C"), work_tier_rank(tier), priority DESC, due_at, id) WHERE kind = 'lead' AND status = 'waiting' AND value->>'platform' IS NULL`,
] as const;

/** A link found later is read first within its tier: its priority is the seconds since 2026 began, which fit the column until 2094. */
export const newestFirst = (foundAt: string): number => Math.max(0, Math.floor((Date.parse(foundAt) - Date.UTC(2026, 0, 1)) / 1000));

function row(raw: Record<string, unknown>): WorkRow {
  const date = (at: unknown) => at === null || at === undefined ? null : new Date(at as string | Date).toISOString();
  return { id: String(raw.id), kind: raw.kind as WorkKind, tier: raw.tier as WorkTier, priority: Number(raw.priority), state: String(raw.state),
    status: raw.status as WorkStatus, placeId: raw.place_id as string | null, subjectId: raw.subject_id as string | null, field: raw.field as string | null,
    url: raw.url as string | null, sources: raw.sources as string[], reports: raw.reports as WorkRow["reports"], value: raw.value,
    quote: raw.quote as string | null, dueAt: date(raw.due_at)!, leaseUntil: date(raw.lease_until), leaseOwner: raw.lease_owner as string | null,
    attempts: Number(raw.attempts), refusal: raw.refusal as string | null, origin: raw.origin as WorkRow["origin"], steps: raw.steps as OrderStep[],
    series: raw.series as string | null, receivedAt: date(raw.received_at)!, doneAt: date(raw.done_at), contentVersion: Number(raw.content_version),
    leaseVersion: raw.lease_version === null ? null : Number(raw.lease_version) };
}

function link(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("WORK_HTTP_URL_REQUIRED");
  url.hash = "";
  return url.href;
}

/** A URL is one piece of work across reports; a claim keeps its id when its value changes. */
export function workId(input: Pick<WorkInput, "kind" | "url" | "subjectId" | "field" | "claimKey">): string {
  return `work-${createHash("sha256").update(canonicalJson(input.field
    ? [input.kind, input.subjectId, input.field, input.claimKey ?? null]
    : input.url ? [input.kind, link(input.url)] : [input.kind, input.subjectId, input.claimKey ?? null])).digest("hex")}`;
}

/** Everything the list writes about one input, checked once. */
function prepared(input: WorkInput, at: string) {
  const tier = input.tier ?? "coverage";
  if (!WORK_KINDS.includes(input.kind) || !WORK_TIERS.includes(tier) || !input.placeId || !input.subjectId
    || input.field !== undefined && !input.field.trim() || !Number.isSafeInteger(input.priority ?? 0)) throw new Error("WORK_INVALID_INPUT");
  if ((input.kind === "lead" || input.kind === "load") && !input.url) throw new Error("WORK_HTTP_URL_REQUIRED");
  const state = (input.state ?? registryJurisdictions(input.placeId)[0] ?? registryJurisdictions(input.subjectId)[0] ?? "US").toUpperCase();
  if (state !== "US" && !(REGISTRY_STATES as readonly string[]).includes(state)) throw new Error("WORK_INVALID_STATE");
  return { id: workId(input), kind: input.kind, tier, priority: input.priority ?? 0, state, place_id: input.placeId, subject_id: input.subjectId,
    field: input.field ?? null, url: input.url ? link(input.url) : null,
    reports: [{ placeId: input.placeId, subjectId: input.subjectId, url: input.url ?? null, ...input.source }],
    sources: input.sources ?? [], value: input.value ?? null, quote: input.quote ?? null, origin: input.origin,
    series: input.series ?? null, due_at: input.dueAt ?? at };
}

const RECEIVED_STEP = (tier: string, at: string) => `CASE WHEN ${tier}='order' THEN jsonb_build_array(jsonb_build_object('step','Received','at',${at})) ELSE '[]'::jsonb END`;
const COLUMNS = "id,kind,tier,priority,state,place_id,subject_id,field,url,reports,sources,value,quote,due_at,received_at,origin,steps,series";

export const CLAIM_WORK_SQL = `WITH selected AS MATERIALIZED (
  SELECT id FROM work WHERE kind = $1 AND status = 'waiting' AND due_at <= $2::timestamptz
    AND ($6::text IS NULL OR starts_with(subject_id,$6))
    AND ($7::text IS NULL OR state = $7)
    AND ($8::boolean IS NOT TRUE OR value->>'plain' = 'true')
    AND ($9::text IS NULL OR value->>'platform' = $9)
    AND ($10::boolean IS NOT TRUE OR value->>'platform' IS NULL)
    AND ($11::text IS NULL OR subject_id COLLATE "C" = $11 OR (subject_id COLLATE "C" >= $11 || '#' AND subject_id COLLATE "C" < $11 || '$'))
  ORDER BY work_tier_rank(tier), priority DESC, due_at, id FOR UPDATE SKIP LOCKED LIMIT $3
) UPDATE work w SET status = 'taken', lease_owner = $4,
    lease_until = $2::timestamptz + $5::int * interval '1 millisecond',
    lease_version = content_version, attempts = attempts + 1,
    steps = CASE WHEN w.tier = 'order' AND w.steps->-1->>'step' IS DISTINCT FROM 'In progress'
      THEN w.steps || jsonb_build_array(jsonb_build_object('step','In progress','at',$2::timestamptz)) ELSE w.steps END
  FROM selected WHERE w.id = selected.id RETURNING w.*`;

/** Recovery is bounded and indexed; a claimant never waits on a dead worker's lock. */
export const EXPIRE_WORK_SQL = `WITH expired AS MATERIALIZED (
  SELECT id FROM work WHERE status = 'taken' AND lease_until <= $1::timestamptz
  ORDER BY lease_until, id FOR UPDATE SKIP LOCKED LIMIT $2
) UPDATE work w SET status = 'waiting', lease_until = NULL, lease_owner = NULL, lease_version = NULL
  FROM expired WHERE w.id = expired.id RETURNING w.id`;

// A source fingerprint identifies the record, independently of the page pointer it came in on. A link reported for a subject it was not yet
// reported for is read again, so its facts are filed for that subject too.
const VALUE_CHANGED_SQL = `(work.kind = 'lead' AND EXISTS (SELECT 1 FROM jsonb_array_elements(EXCLUDED.reports) n WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(work.reports) o WHERE o->>'subjectId' = n->>'subjectId' AND o->>'placeId' = n->>'placeId'))
  OR CASE WHEN EXCLUDED.value->>'$sourceFingerprint' ~ '^[a-f0-9]{64}$'
  AND work.value->>'$sourceFingerprint' ~ '^[a-f0-9]{64}$'
  THEN work.value->>'$sourceFingerprint' IS DISTINCT FROM EXCLUDED.value->>'$sourceFingerprint'
  ELSE work.value IS DISTINCT FROM EXCLUDED.value END OR work.quote IS DISTINCT FROM EXCLUDED.quote
  OR work.refusal='COPY_OUTSIDE_FRESHNESS_WINDOW' AND work.value IS DISTINCT FROM EXCLUDED.value)`;
/** The same job offered again at a more urgent tier moves up; it never moves down, and a repeat of the same report changes nothing. */
const MOVES_UP_SQL = `(work.status IN ('waiting','taken') AND work_tier_rank(EXCLUDED.tier) < work_tier_rank(work.tier))`;
const UPSERT_SQL = `ON CONFLICT (id) DO UPDATE SET
    tier = CASE WHEN ${MOVES_UP_SQL} THEN EXCLUDED.tier ELSE work.tier END,
    priority = CASE WHEN ${MOVES_UP_SQL} THEN EXCLUDED.priority ELSE work.priority END,
    origin = CASE WHEN ${MOVES_UP_SQL} THEN EXCLUDED.origin ELSE work.origin END,
    state = CASE WHEN EXCLUDED.value->>'$sourceFingerprint' ~ '^[a-f0-9]{64}$' THEN EXCLUDED.state ELSE work.state END,
    place_id = CASE WHEN EXCLUDED.value->>'$sourceFingerprint' ~ '^[a-f0-9]{64}$' THEN EXCLUDED.place_id ELSE work.place_id END,
    reports = CASE WHEN work.kind = 'lead' THEN work.reports || coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(EXCLUDED.reports) n WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(work.reports) o WHERE o->>'subjectId' = n->>'subjectId' AND o->>'placeId' = n->>'placeId')), '[]'::jsonb)
      WHEN work.reports @> EXCLUDED.reports THEN work.reports ELSE work.reports || EXCLUDED.reports END,
    sources = CASE WHEN EXCLUDED.value->>'$sourceFingerprint' ~ '^[a-f0-9]{64}$' THEN EXCLUDED.sources
      ELSE (SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) FROM jsonb_array_elements(work.sources || EXCLUDED.sources) item) END,
    content_version = work.content_version + CASE WHEN ${VALUE_CHANGED_SQL} THEN 1 ELSE 0 END,
    status = CASE WHEN work.status <> 'taken' AND ${VALUE_CHANGED_SQL} THEN 'waiting' ELSE work.status END,
    dead_since = CASE WHEN work.status <> 'taken' AND ${VALUE_CHANGED_SQL} THEN NULL ELSE work.dead_since END,
    due_at = CASE WHEN work.status <> 'taken' AND ${VALUE_CHANGED_SQL} THEN EXCLUDED.due_at
      WHEN work.status = 'waiting' AND ${MOVES_UP_SQL} THEN least(work.due_at, EXCLUDED.due_at) ELSE work.due_at END,
    refusal = CASE WHEN ${VALUE_CHANGED_SQL} THEN NULL ELSE work.refusal END,
    url = EXCLUDED.url,
    value = EXCLUDED.value, quote = EXCLUDED.quote`;
/** A row asked for again: one that is finished or refused waits again, due now; one being worked is done once more after; one already waiting is left as it is. */
const TOUCH_SQL = `ON CONFLICT (id) DO UPDATE SET content_version = work.content_version + 1,
    status = CASE WHEN work.status = 'taken' THEN 'taken' ELSE 'waiting' END,
    due_at = EXCLUDED.due_at, refusal = NULL, dead_since = NULL WHERE work.status <> 'waiting'`;
const ADD_WORK_SQL = `INSERT INTO work (${COLUMNS})
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,jsonb_build_array($10::jsonb),$11::jsonb,$12::jsonb,$13,$14::timestamptz,$15::timestamptz,$16::jsonb,
    ${RECEIVED_STEP("$3::text", "$15::timestamptz")},NULL)
  ${UPSERT_SQL} RETURNING *`;
const RECORDS = `jsonb_to_recordset($1::jsonb) AS r(id text,kind text,tier text,priority int,state text,place_id text,subject_id text,field text,
  url text,reports jsonb,sources jsonb,value jsonb,quote text,origin jsonb,series text,due_at timestamptz)`;
const SELECT_RECORDS = `SELECT r.id,r.kind,r.tier,r.priority,r.state,r.place_id,r.subject_id,r.field,r.url,r.reports,r.sources,coalesce(r.value,'null'::jsonb),
  r.quote,coalesce(r.due_at,$2::timestamptz),$2::timestamptz,r.origin,${RECEIVED_STEP("r.tier", "$2::timestamptz")},r.series FROM ${RECORDS}`;
/** A repeating job has a live row, or a finished one waiting to repeat; either way nothing else is made. */
const NOT_IN_SERIES = `WHERE r.series IS NULL OR NOT EXISTS (SELECT 1 FROM work w WHERE w.series = r.series AND (w.status IN ('waiting','taken') OR w.repeat_ms IS NOT NULL))`;

const SOONER_SQL = `INSERT INTO work (${COLUMNS})
  VALUES ($1,'hunt','reader',1,$2,$3,$4,NULL,NULL,jsonb_build_array($5::jsonb),'[]'::jsonb,'null'::jsonb,NULL,$6::timestamptz,$6::timestamptz,$7::jsonb,
    ${RECEIVED_STEP("'reader'", "$6::timestamptz")},$8)
  ON CONFLICT (series) WHERE series IS NOT NULL AND status IN ('waiting','taken') DO UPDATE SET
    tier = CASE WHEN work_tier_rank(work.tier) > work_tier_rank('reader') THEN 'reader' ELSE work.tier END,
    priority = CASE WHEN work.tier = 'reader' THEN work.priority + 1 WHEN work_tier_rank(work.tier) > work_tier_rank('reader') THEN 1 ELSE work.priority END,
    due_at = CASE WHEN work.status = 'waiting' THEN least(work.due_at, EXCLUDED.due_at) ELSE work.due_at END,
    origin = work.origin || jsonb_build_object('presses', coalesce((work.origin->>'presses')::int,0) + 1)
  RETURNING *`;

const ORDER_SQL = `INSERT INTO work (id,kind,tier,priority,state,place_id,subject_id,reports,due_at,received_at,origin,steps)
  VALUES ($1,'order','order',0,$2,$3,$4,jsonb_build_array($5::jsonb),$6::timestamptz,$6::timestamptz,$7::jsonb,$8::jsonb) ON CONFLICT (id) DO NOTHING`;
/** A step is stored once; reaching Done also closes the row and keeps what the order finally said. */
const ADVANCE_ORDER_SQL = `UPDATE work SET steps = steps || jsonb_build_array(jsonb_build_object('step',$2::text,'at',$3::timestamptz)),
    status = CASE WHEN $2 = 'Done' THEN 'done' ELSE status END,
    done_at = CASE WHEN $2 = 'Done' THEN $3::timestamptz ELSE done_at END,
    done_times = CASE WHEN $2 = 'Done' THEN array_append(done_times,$3::timestamptz) ELSE done_times END,
    value = CASE WHEN $2 = 'Done' THEN $4::jsonb ELSE value END
  WHERE id = $1 AND kind = 'order' AND NOT steps @> jsonb_build_array(jsonb_build_object('step',$2::text)) RETURNING id`;
/** Finished rows are kept for a time; an order's row is kept longer, since Admin's history reads it. */
const RETIRE_WORK_SQL = `WITH old AS (
  SELECT id FROM work WHERE status = 'done' AND repeat_ms IS NULL AND dead_since IS NULL
    AND done_at < CASE WHEN kind = 'order' THEN $2::timestamptz ELSE $1::timestamptz END ORDER BY done_at LIMIT $3
) DELETE FROM work w USING old WHERE w.id = old.id RETURNING w.id`;

/** A finished job that repeats gets its next row when it is due, so the list holds only what is owed now. */
const SPAWN_WORK_SQL = `WITH due AS MATERIALIZED (
  SELECT id, repeat_ms, series = ANY($3::text[]) AS asked FROM work WHERE status = 'done' AND repeat_ms IS NOT NULL
    AND (done_at + repeat_ms * interval '1 millisecond' <= $1::timestamptz OR series = ANY($3::text[]))
  ORDER BY done_at, id FOR UPDATE SKIP LOCKED LIMIT $2
), spent AS (
  UPDATE work w SET repeat_ms = NULL, dead_since = NULL FROM due WHERE w.id = due.id RETURNING w.*, due.repeat_ms AS cadence, due.asked
)
INSERT INTO work (${COLUMNS})
SELECT 'work-' || md5(s.id || ':' || s.done_at::text), s.kind, s.tier, s.priority, s.state, s.place_id, s.subject_id, s.field, s.url, s.reports, s.sources,
  s.value, s.quote, CASE WHEN s.asked THEN $1::timestamptz ELSE s.done_at + s.cadence * interval '1 millisecond' END, $1::timestamptz, s.origin,
  ${RECEIVED_STEP("s.tier", "$1::timestamptz")}, coalesce(s.series, s.id)
FROM spent s ON CONFLICT DO NOTHING RETURNING id`;

/**
 * A dead end goes back on the list as the same row, waiting and due now, and keeps what it waited for and what reopened it. A
 * planned task is spent, so its row is asked again as the hunt for its place. A row whose series is live again is left alone.
 */
const reopenSql = (due: string) => `WITH due AS MATERIALIZED (
  SELECT id FROM work WHERE dead_since IS NOT NULL AND status IN ('refused','done') AND ${due}
    AND NOT EXISTS (SELECT 1 FROM work live WHERE live.series = work.series AND live.status IN ('waiting','taken'))
  ORDER BY dead_since, id FOR UPDATE SKIP LOCKED LIMIT $2
) UPDATE work w SET status = 'waiting', due_at = $1::timestamptz, dead_since = NULL, repeat_ms = NULL, refusal = NULL,
  subject_id = CASE WHEN w.value ? 'routeTaskId' THEN w.place_id ELSE w.subject_id END,
  value = CASE WHEN w.value ? 'routeTaskId' THEN 'null'::jsonb ELSE w.value END,
  reopened = jsonb_build_object('at', $1::timestamptz, 'because', $3::text, 'waitedFor', w.unlock)
FROM due WHERE w.id = due.id RETURNING w.id`;
/** The dead ends a new capability unlocks: it names every place or thing the dead end names, they share at least one, and the dead end is older. */
const UNLOCKED_BY_SQL = reopenSql(`unlock->>'kind' = $4 AND dead_since < $5::timestamptz
    AND (unlock->>'name' IS NULL OR $6::text IS NULL OR unlock->>'name' = $6) AND (unlock->>'state' IS NULL OR $7::text IS NULL OR unlock->>'state' = $7)
    AND (unlock->>'platform' IS NULL OR $8::text IS NULL OR unlock->>'platform' = $8) AND (unlock->>'govKind' IS NULL OR $9::text IS NULL OR unlock->>'govKind' = $9)
    AND (unlock->>'name' IS NOT NULL AND $6::text IS NOT NULL OR unlock->>'state' IS NOT NULL AND $7::text IS NOT NULL
      OR unlock->>'platform' IS NOT NULL AND $8::text IS NOT NULL OR unlock->>'govKind' IS NOT NULL AND $9::text IS NOT NULL)`);
const STALE_SQL = reopenSql("dead_since <= $4::timestamptz");

export interface ReopenInput {
  readonly at: string;
  readonly because: string;
  readonly limit: number;
  /** Dead ends this capability unlocks. */
  readonly capability?: StoredCapability;
  /** Dead ends waiting since this instant or earlier. */
  readonly waitingSince?: string;
}

/** Each transition and its hourly count commit together. */
/** What a hunt row keeps of its own hunt: the work item, the route task and the lease are one each; attempts are kept by id. */
export type RunPart = "item" | "task" | "lease" | "attempt";

/** Saves one part of a hunt on the row it ran from. */
export async function saveRun(query: Query, rowId: string, part: RunPart, key: string, value: unknown): Promise<void> {
  await query(part === "attempt"
    ? `UPDATE work SET run = jsonb_set(CASE WHEN run ? 'attempts' THEN run ELSE run || '{"attempts":{}}'::jsonb END, ARRAY['attempts', $2::text], $3::jsonb) WHERE id = $1`
    : `UPDATE work SET run = run || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1`,
  [rowId, part === "attempt" ? key : part, canonicalJson(value)]);
}

/** The attempt reports a row keeps besides its first. */
export const ATTEMPT_REPORTS_KEPT = 20;

export function workList(query: Query, options: { readonly owner: string; readonly leaseMs?: number; readonly now?: () => Date }) {
  // PostgreSQL binds "now" at execution; worker clock skew cannot expire another worker's lease.
  const leaseMs = options.leaseMs ?? 30_000, timestamp = () => options.now?.().toISOString() ?? "now";
  if (!options.owner.trim() || !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new Error("WORK_INVALID_LEASE");
  const recover = async (limit = 1_000): Promise<number> => (await query(EXPIRE_WORK_SQL, [timestamp(), limit])).length;
  const fenced = (claim: WorkRow) => {
    if (claim.status !== "taken" || !claim.leaseOwner) throw new Error("WORK_CLAIM_REQUIRED");
    return [claim.id, claim.leaseOwner, timestamp()];
  };
  const records = (inputs: readonly WorkInput[], at: string) => {
    if (inputs.length > 1_000) throw new Error("WORK_INVALID_BATCH");
    return JSON.stringify(inputs.map(input => prepared(input, at)));
  };
  /** A claimed row goes back to waiting without the claim counting as an attempt; with `until` it is not due before then. */
  const release = async (claim: WorkRow, until?: string): Promise<boolean> => (await query(`UPDATE work SET status = 'waiting', lease_owner = NULL, lease_until = NULL,
    lease_version = NULL, attempts = greatest(attempts - 1, 0), due_at = coalesce($3::timestamptz, due_at) WHERE id = $1 AND lease_owner = $2 AND status = 'taken' RETURNING id`,
  [claim.id, claim.leaseOwner, until ?? null])).length === 1;
  return {
    async add(input: WorkInput): Promise<WorkRow> {
      if (input.series !== undefined) throw new Error("WORK_INVALID_INPUT");
      const at = timestamp(), one = prepared(input, at);
      const [saved] = await query(ADD_WORK_SQL, [one.id, one.kind, one.tier, one.priority, one.state, one.place_id, one.subject_id, one.field, one.url,
        canonicalJson(one.reports[0]), canonicalJson(one.sources), canonicalJson(one.value), one.quote, one.due_at, at, canonicalJson(one.origin)]);
      return row(saved!);
    },
    /** One tenant's pointer rows cross together; no response or parsed record is copied into the list. */
    async addMany(inputs: readonly WorkInput[]): Promise<number> {
      if (!inputs.length) return 0;
      if (inputs.some(input => input.kind !== "lead" && !input.field?.trim() || input.series !== undefined)) throw new Error("WORK_INVALID_INPUT");
      const at = timestamp(), rows = new Map<string, ReturnType<typeof prepared>>();
      for (const input of inputs) {
        // A link offered twice in one batch is one row that keeps a report for each place that found it.
        const one = prepared(input, at), held = rows.get(one.id);
        const fresh = held ? one.reports.filter(report => !held.reports.some(known => known.subjectId === report.subjectId && known.placeId === report.placeId)) : [];
        rows.set(one.id, held ? { ...held, reports: [...held.reports, ...fresh], sources: [...new Set([...held.sources, ...one.sources])] } : one);
      }
      if (rows.size > 1_000) throw new Error("WORK_INVALID_BATCH");
      return (await query(`INSERT INTO work (${COLUMNS}) ${SELECT_RECORDS} WHERE true ${UPSERT_SQL} RETURNING id`, [JSON.stringify([...rows.values()]), at])).length;
    },
    /** Each row is made to wait again, due now, whatever it was; rows already waiting are not written. */
    async touch(inputs: readonly WorkInput[]): Promise<number> {
      if (!inputs.length) return 0;
      if (inputs.some(input => !input.field?.trim() || input.series !== undefined)) throw new Error("WORK_INVALID_INPUT");
      const at = timestamp(), unique = new Map(inputs.map(input => [workId(input), input]));
      return (await query(`INSERT INTO work (${COLUMNS}) ${SELECT_RECORDS} WHERE true ${TOUCH_SQL} RETURNING id`, [records([...unique.values()], at), at])).length;
    },
    /** Rows that are not there yet; a job already live in its series, or waiting to repeat, is left as it is. */
    async ensure(inputs: readonly WorkInput[]): Promise<number> {
      if (!inputs.length) return 0;
      const at = timestamp();
      return (await query(`INSERT INTO work (${COLUMNS}) ${SELECT_RECORDS} ${NOT_IN_SERIES} ON CONFLICT DO NOTHING RETURNING id`, [records(inputs, at), at])).length;
    },
    /** A reader asked for this subject sooner: its one live hunt moves to the reader tier, and each further press moves it up. */
    async sooner(input: { readonly placeId: string; readonly subjectId: string; readonly subjectType: string; readonly state?: string }): Promise<WorkRow> {
      const origin: WorkOrigin = { from: "demand", subjectType: input.subjectType, presses: 1 };
      const at = timestamp(), one = prepared({ kind: "hunt", tier: "reader", placeId: input.placeId, subjectId: input.subjectId, state: input.state,
        origin, source: { source: "Want us to get this sooner?" } }, at);
      const series = `blank:${input.subjectId}`;
      const [saved] = await query(SOONER_SQL, [`work-${createHash("sha256").update(canonicalJson([series, randomUUID()])).digest("hex")}`, one.state, one.place_id,
        one.subject_id, canonicalJson(one.reports[0]), at, canonicalJson(origin), series]);
      return row(saved!);
    },
    /** An order Sean gave is on the list from the moment it is accepted; replaying it changes nothing. */
    async order(input: { readonly receiptId: string; readonly label: string; readonly placeId?: string; readonly state?: string; readonly at: string }): Promise<void> {
      await query(ORDER_SQL, [workId({ kind: "order", subjectId: input.receiptId }), (input.state ?? "US").toUpperCase(), input.placeId ?? "ocd-division/country:us",
        input.receiptId, canonicalJson({ source: "Admin order", label: input.label }), input.at, canonicalJson({ from: "order", orderId: input.receiptId }),
        canonicalJson([{ step: "Received", at: input.at }, { step: "Accepted", at: input.at }])]);
    },
    /** The order reaches a step; one it has already reached is left alone. */
    async advanceOrder(receiptId: string, step: OrderStep["step"], at: string, final: unknown = null): Promise<boolean> {
      return (await query(ADVANCE_ORDER_SQL, [workId({ kind: "order", subjectId: receiptId }), step, at, canonicalJson(final)])).length === 1;
    },
    /** What the order's row holds: the steps it has reached, and what it finally said once done. */
    async readOrder(receiptId: string): Promise<{ readonly steps: readonly OrderStep[]; readonly final: unknown; readonly done: boolean } | null> {
      const [saved] = await query("SELECT steps,value,status FROM work WHERE id = $1 AND kind = 'order'", [workId({ kind: "order", subjectId: receiptId })]);
      return saved ? { steps: saved.steps as OrderStep[], final: saved.value, done: saved.status === "done" } : null;
    },
    /** Finished rows older than their keeping time are deleted, oldest first. */
    async retire(input: { readonly rowsBefore: string; readonly ordersBefore: string; readonly limit?: number }): Promise<number> {
      return (await query(RETIRE_WORK_SQL, [input.rowsBefore, input.ordersBefore, input.limit ?? 5_000])).length;
    },
    /** Makes the next row of every finished job that has come due again. */
    async spawnDue(limit = 1_000): Promise<number> {
      return (await query(SPAWN_WORK_SQL, [timestamp(), limit, []])).length;
    },
    /** Finished jobs in these series that were waiting to repeat are made again now, because something new gave them a reason. */
    async again(series: readonly string[]): Promise<number> {
      return series.length ? (await query(SPAWN_WORK_SQL, [timestamp(), series.length, series])).length : 0;
    },
    /** Dead ends that a new capability unlocks, or that have waited since the given instant, are made again now; the count is how many. */
    async reopen(input: ReopenInput): Promise<number> {
      const { capability: c } = input;
      return (await query(c ? UNLOCKED_BY_SQL : STALE_SQL, [input.at, input.limit, input.because,
        ...(c ? [c.kind, c.at, c.name ?? null, c.state ?? null, c.platform ?? null, c.govKind ?? null] : [input.waitingSince])])).length;
    },
    /** The next rows of these kinds in tier order. A state, or only the rows that need no paid model, can be asked for. */
    async claim(kinds: WorkKind | readonly WorkKind[], n: number, narrowed: string | ClaimWhere = {}): Promise<readonly WorkRow[]> {
      if (!Number.isSafeInteger(n) || n < 1 || n > 1_000) throw new Error("WORK_INVALID_BATCH");
      const where: ClaimWhere = typeof narrowed === "string" ? { subjectPrefix: narrowed } : narrowed;
      await recover();
      const owner = `${options.owner}:${randomUUID()}`, at = timestamp();
      const taken: WorkRow[] = [];
      for (const kind of typeof kinds === "string" ? [kinds] : kinds) {
        taken.push(...(await query(CLAIM_WORK_SQL, [kind, at, n, owner, leaseMs, where.subjectPrefix ?? null, where.state?.toUpperCase() ?? null,
          where.plainOnly ?? null, where.platform ?? null, where.untagged ?? null, where.government ?? null])).map(row));
      }
      taken.sort(IN_TIER_ORDER);
      for (const extra of taken.splice(n)) await release(extra);
      return taken;
    },
    /** Which of these kinds of website holds the link a claim would serve first: the lowest tier, then the newest. Null when none has one waiting. */
    async firstPlatform(platforms: readonly string[]): Promise<string | null> {
      const [first] = await query(`SELECT p.platform FROM unnest($1::text[]) AS p(platform) CROSS JOIN LATERAL (
          SELECT work_tier_rank(tier) AS rank, priority, due_at, id FROM work WHERE kind = 'lead' AND status = 'waiting' AND due_at <= $2::timestamptz
            AND value->>'platform' = p.platform ORDER BY work_tier_rank(tier), priority DESC, due_at, id LIMIT 1
        ) head ORDER BY head.rank, head.priority DESC, head.due_at, head.id LIMIT 1`, [platforms, timestamp()]);
      return first ? String(first.platform) : null;
    },
    /** Whether a claim of these kinds would find a row: one waiting and due, or one whose lease has run out. */
    async ready(kinds: readonly WorkKind[], where: ClaimWhere = {}): Promise<boolean> {
      const at = timestamp();
      return (await query(`SELECT 1 AS ready FROM work WHERE kind = ANY($1::text[]) AND status = 'waiting' AND due_at <= $2::timestamptz
          AND ($3::text IS NULL OR state = $3) AND ($4::boolean IS NOT TRUE OR value->>'plain' = 'true')
        UNION ALL SELECT 1 FROM work WHERE kind = ANY($1::text[]) AND status = 'taken' AND lease_until <= $2::timestamptz AND ($3::text IS NULL OR state = $3) LIMIT 1`,
      [kinds, at, where.state?.toUpperCase() ?? null, where.plainOnly ?? null])).length > 0;
    },
    /** A claimed row goes back to waiting as if it had never been taken. */
    release,
    recover,
    async renew(claim: WorkRow): Promise<boolean> {
      return (await query(`UPDATE work SET lease_until=$3::timestamptz+$4::int*interval '1 millisecond'
        WHERE id=$1 AND lease_owner=$2 AND status='taken' AND lease_until>$3::timestamptz RETURNING id`, [...fenced(claim), leaseMs])).length === 1;
    },
    /** What a claimed row's hunt did is added to its reports; the row keeps the first report and the latest {@link ATTEMPT_REPORTS_KEPT} attempts. */
    async report(claim: WorkRow, report: Readonly<Record<string, unknown>>): Promise<boolean> {
      const [id, owner] = fenced(claim);
      return (await query(`UPDATE work SET reports = CASE WHEN jsonb_array_length(reports) > $4::int THEN reports - 1 ELSE reports END || $3::jsonb
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' RETURNING id`, [id, owner, canonicalJson([report]), ATTEMPT_REPORTS_KEPT])).length === 1;
    },
    /** With a cadence, the job repeats: its next row is made when that long has passed. */
    async finish(claim: WorkRow, repeatMs?: number, deadEnd?: Unlock): Promise<boolean> {
      if (repeatMs !== undefined && (!Number.isSafeInteger(repeatMs) || repeatMs < 1)) throw new Error("WORK_INVALID_CADENCE");
      const [saved] = await query(`UPDATE work SET
        status = CASE WHEN content_version = lease_version THEN 'done' ELSE 'waiting' END,
        refusal = NULL,
        done_times = CASE WHEN content_version = lease_version THEN array_append(done_times,$3::timestamptz) ELSE done_times END,
        done_at = CASE WHEN content_version = lease_version THEN $3::timestamptz ELSE done_at END,
        repeat_ms = CASE WHEN content_version = lease_version THEN $4::bigint ELSE repeat_ms END,
        unlock = CASE WHEN content_version = lease_version THEN $5::jsonb ELSE unlock END,
        dead_since = CASE WHEN content_version = lease_version AND $5::jsonb IS NOT NULL THEN $3::timestamptz END,
        due_at = CASE WHEN content_version <> lease_version THEN $3::timestamptz ELSE due_at END,
        steps = CASE WHEN tier = 'order' AND content_version = lease_version
          THEN steps || jsonb_build_array(jsonb_build_object('step','Done','at',$3::timestamptz)) ELSE steps END,
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING status,content_version`,
        [...fenced(claim), repeatMs ?? null, deadEnd ? canonicalJson(deadEnd) : null]);
      return Number(saved?.content_version) === claim.leaseVersion && saved?.status === "done";
    },
    async later(claim: WorkRow, reason: string): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [saved] = await query(`UPDATE work SET status = 'waiting', refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
        due_at = $3::timestamptz + CASE WHEN content_version <> lease_version THEN 0 ELSE least(86400000::bigint, 1000::bigint * power(2, least(attempts - 1, 17))::bigint) END * interval '1 millisecond',
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING id`, [...fenced(claim), reason]);
      return saved !== undefined;
    },
    async refuse(claim: WorkRow, reason: string, deadEnd?: Unlock): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [saved] = await query(`WITH refused AS (
        UPDATE work SET status = CASE WHEN content_version = lease_version THEN 'refused' ELSE 'waiting' END,
          refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
          refused_times = CASE WHEN content_version = lease_version THEN array_append(refused_times,$3::timestamptz) ELSE refused_times END,
          unlock = CASE WHEN content_version = lease_version THEN $5::jsonb ELSE unlock END,
          dead_since = CASE WHEN content_version = lease_version AND $5::jsonb IS NOT NULL THEN $3::timestamptz END,
          lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING *
      ), detective AS (
        INSERT INTO work (id,kind,tier,priority,state,place_id,subject_id,field,url,reports,sources,value,quote,due_at,received_at,origin,steps)
        SELECT 'detect-' || id,'detect',tier,priority,state,place_id,subject_id,field,url,
          jsonb_build_array(jsonb_build_object('workId',id,'reason',$4,'version',content_version)),sources,value,quote,$3,$3,
          jsonb_build_object('from','detective','workId',id),${RECEIVED_STEP("tier", "$3::timestamptz")}
        FROM refused WHERE status = 'refused' AND kind <> 'detect'
        ON CONFLICT (id) DO UPDATE SET reports = work.reports || EXCLUDED.reports,
          sources = (SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) FROM jsonb_array_elements(work.sources || EXCLUDED.sources) item),
          status = CASE WHEN work.status = 'taken' THEN 'taken' ELSE 'waiting' END,
          content_version = work.content_version + 1, value = EXCLUDED.value, quote = EXCLUDED.quote, url = EXCLUDED.url,
          due_at = EXCLUDED.due_at, refusal = NULL
      ) SELECT status FROM refused`, [...fenced(claim), reason, deadEnd ? canonicalJson(deadEnd) : null]);
      return saved?.status === "refused";
    },
  };
}

export type WorkList = ReturnType<typeof workList>;

/** The control-plane database as the website and the runner both reach it. */
export function controlPlaneQuery(env: Readonly<Record<string, string | undefined>> = process.env): Query {
  const url = env.WTP_CONTROL_PLANE_DATABASE_URL?.trim();
  if (!url) throw new Error("WORK_STORE_UNAVAILABLE");
  const sql = neon(url);
  return async (text, params = []) => await sql.query(text, [...params]) as Record<string, unknown>[];
}
