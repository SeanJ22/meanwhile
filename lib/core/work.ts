import { createHash, randomUUID } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { registryJurisdictions, REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { WorkKind, WorkRow as SharedWorkRow } from "./shapes.ts";

export interface WorkInput {
  readonly kind: WorkKind;
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
  readonly priority?: number;
}

export interface WorkRow extends SharedWorkRow {
  readonly status: "ready" | "taken" | "done" | "refused";
  readonly reports: readonly Readonly<Record<string, unknown>>[];
  readonly field: string | null;
  readonly value: unknown;
  readonly quote: string | null;
  readonly contentVersion: number;
  readonly leaseVersion: number | null;
}

function row(raw: Record<string, unknown>): WorkRow {
  const date = (at: unknown) => at === null ? null : new Date(at as string | Date).toISOString();
  return { id: String(raw.id), kind: raw.kind as WorkKind, state: String(raw.state), status: raw.status as WorkRow["status"],
    placeId: raw.place_id as string | null, subjectId: raw.subject_id as string | null, url: raw.url as string | null,
    sources: raw.sources as string[], reports: raw.reports as WorkRow["reports"], priority: Number(raw.priority),
    notBefore: date(raw.not_before)!, leaseUntil: date(raw.lease_until), leaseOwner: raw.lease_owner as string | null,
    attempts: Number(raw.attempts), refusal: raw.refusal as string | null, field: raw.field as string | null,
    value: raw.value, quote: raw.quote as string | null, contentVersion: Number(raw.content_version),
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

export const CLAIM_WORK_SQL = `WITH selected AS MATERIALIZED (
  SELECT id FROM work_row WHERE kind = $1 AND status = 'ready' AND not_before <= $2::timestamptz
  ORDER BY priority DESC, not_before, id FOR UPDATE SKIP LOCKED LIMIT $3
) UPDATE work_row w SET status = 'taken', lease_owner = $4,
    lease_until = $2::timestamptz + $5::int * interval '1 millisecond',
    lease_version = content_version, attempts = attempts + 1
  FROM selected WHERE w.id = selected.id RETURNING w.*`;

/** Recovery is bounded and indexed; a claimant never waits on a dead worker's lock. */
export const EXPIRE_WORK_SQL = `WITH expired AS MATERIALIZED (
  SELECT id FROM work_row WHERE status = 'taken' AND lease_until <= $1::timestamptz
  ORDER BY lease_until, id FOR UPDATE SKIP LOCKED LIMIT $2
) UPDATE work_row w SET status = 'ready', lease_until = NULL, lease_owner = NULL, lease_version = NULL
  FROM expired WHERE w.id = expired.id RETURNING w.id`;

const ADD_WORK_SQL = `INSERT INTO work_row
  (id,kind,state,place_id,subject_id,url,reports,priority,not_before,field,value,quote,received_at,sources)
  VALUES ($1,$2,$12,$3,$4,$5,jsonb_build_array($6::jsonb),$7,$8,$9,$10::jsonb,$11,$8,$13::jsonb)
  ON CONFLICT (id) DO UPDATE SET
    reports = CASE WHEN work_row.reports @> EXCLUDED.reports THEN work_row.reports ELSE work_row.reports || EXCLUDED.reports END,
    sources = (SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) FROM jsonb_array_elements(work_row.sources || EXCLUDED.sources) item),
    content_version = work_row.content_version + CASE WHEN work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote THEN 1 ELSE 0 END,
    status = CASE WHEN work_row.status <> 'taken' AND (work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote) THEN 'ready' ELSE work_row.status END,
    not_before = CASE WHEN work_row.status <> 'taken' AND (work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote) THEN EXCLUDED.not_before ELSE work_row.not_before END,
    refusal = CASE WHEN work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote THEN NULL ELSE work_row.refusal END,
    value = EXCLUDED.value, quote = EXCLUDED.quote
  RETURNING *`;

/** Each transition and its hourly count commit together. */
export function workList(query: Query, options: { readonly owner: string; readonly leaseMs?: number; readonly now?: () => Date }) {
  const leaseMs = options.leaseMs ?? 30_000, now = options.now ?? (() => new Date());
  if (!options.owner.trim() || !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new Error("WORK_INVALID_LEASE");
  const recover = async (limit = 1_000): Promise<number> => (await query(EXPIRE_WORK_SQL, [now().toISOString(), limit])).length;
  const fenced = (claim: WorkRow) => {
    if (claim.status !== "taken" || !claim.leaseOwner) throw new Error("WORK_CLAIM_REQUIRED");
    return [claim.id, claim.leaseOwner, now().toISOString()];
  };
  return {
    async add(input: WorkInput): Promise<WorkRow> {
      if (!input.placeId || !input.subjectId || !["read", "check", "load", "hunt", "detect", "audit"].includes(input.kind)
        || input.field !== undefined && !input.field.trim() || !Number.isSafeInteger(input.priority ?? 0)) throw new Error("WORK_INVALID_INPUT");
      if ((input.kind === "read" || input.kind === "load") && !input.url) throw new Error("WORK_HTTP_URL_REQUIRED");
      const state = (input.state ?? registryJurisdictions(input.placeId)[0] ?? registryJurisdictions(input.subjectId)[0] ?? "US").toUpperCase();
      if (state !== "US" && !(REGISTRY_STATES as readonly string[]).includes(state)) throw new Error("WORK_INVALID_STATE");
      const [saved] = await query(ADD_WORK_SQL, [workId(input), input.kind, input.placeId, input.subjectId, input.url ? link(input.url) : null,
        canonicalJson({ ...input.source, placeId: input.placeId, subjectId: input.subjectId, url: input.url ?? null }), input.priority ?? 0,
        now().toISOString(), input.field ?? null, canonicalJson(input.value ?? null), input.quote ?? null, state, canonicalJson(input.sources ?? [])]);
      return row(saved!);
    },
    async claim(kind: WorkKind, n: number): Promise<readonly WorkRow[]> {
      if (!Number.isSafeInteger(n) || n < 1 || n > 1_000) throw new Error("WORK_INVALID_BATCH");
      await recover();
      return (await query(CLAIM_WORK_SQL, [kind, now().toISOString(), n, `${options.owner}:${randomUUID()}`, leaseMs])).map(row);
    },
    recover,
    async finish(claim: WorkRow): Promise<boolean> {
      const [saved] = await query(`UPDATE work_row SET
        status = CASE WHEN content_version = lease_version THEN 'done' ELSE 'ready' END,
        refusal = NULL,
        done_times = CASE WHEN content_version = lease_version THEN array_append(done_times,$3::timestamptz) ELSE done_times END,
        not_before = CASE WHEN content_version <> lease_version THEN $3::timestamptz ELSE not_before END,
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING status`, fenced(claim));
      return saved?.status === "done";
    },
    async later(claim: WorkRow, reason: string): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [saved] = await query(`UPDATE work_row SET status = 'ready', refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
        not_before = $3::timestamptz + CASE WHEN content_version <> lease_version THEN 0 ELSE least(86400000::bigint, 1000::bigint * power(2, least(attempts - 1, 17))::bigint) END * interval '1 millisecond',
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING id`, [...fenced(claim), reason]);
      return saved !== undefined;
    },
    async refuse(claim: WorkRow, reason: string): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [saved] = await query(`WITH refused AS (
        UPDATE work_row SET status = CASE WHEN content_version = lease_version THEN 'refused' ELSE 'ready' END,
          refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
          refused_times = CASE WHEN content_version = lease_version THEN array_append(refused_times,$3::timestamptz) ELSE refused_times END,
          lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND status = 'taken' AND lease_until > $3::timestamptz RETURNING *
      ), detective AS (
        INSERT INTO work_row (id,kind,state,place_id,subject_id,url,reports,sources,priority,not_before,field,value,quote,received_at)
        SELECT 'detect-' || id,'detect',state,place_id,subject_id,url,
          jsonb_build_array(jsonb_build_object('workId',id,'reason',$4,'version',content_version)),sources,priority,$3,field,value,quote,$3
        FROM refused WHERE status = 'refused' AND kind <> 'detect'
        ON CONFLICT (id) DO UPDATE SET reports = work_row.reports || EXCLUDED.reports,
          sources = (SELECT coalesce(jsonb_agg(DISTINCT item),'[]'::jsonb) FROM jsonb_array_elements(work_row.sources || EXCLUDED.sources) item),
          status = CASE WHEN work_row.status = 'taken' THEN 'taken' ELSE 'ready' END,
          content_version = work_row.content_version + 1, value = EXCLUDED.value, quote = EXCLUDED.quote,
          not_before = EXCLUDED.not_before, refusal = NULL
      ) SELECT status FROM refused`, [...fenced(claim), reason]);
      return saved?.status === "refused";
    },
  };
}
