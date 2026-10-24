import { createHash, randomUUID } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";

export type WorkKind = "read" | "check" | "load" | "hunt" | "detect" | "audit";
type WorkState = "ready" | "taken" | "done" | "refused";

export interface WorkInput {
  readonly kind: WorkKind;
  readonly placeId: string;
  readonly subjectId: string;
  readonly url?: string | null;
  /** Absent for a link. A claim's field identifies its slot, independently of its value. */
  readonly field?: string;
  /** Stable identity within a multivalued field, such as the seat or person in a membership claim. */
  readonly claimKey?: string;
  readonly value?: unknown;
  readonly quote?: string | null;
  /** A source reference or report, retained even when the content has not changed. */
  readonly source: Readonly<Record<string, unknown>>;
  readonly priority?: number;
}

export interface WorkRow {
  readonly id: string;
  readonly kind: WorkKind;
  readonly state: WorkState;
  readonly place_id: string;
  readonly subject_id: string;
  readonly url: string | null;
  readonly sources: readonly Readonly<Record<string, unknown>>[];
  readonly priority: number;
  readonly not_before: string | Date;
  readonly lease_until: string | Date | null;
  readonly lease_owner: string | null;
  readonly attempts: number;
  readonly refusal: string | null;
  readonly field: string | null;
  readonly value: unknown;
  readonly quote: string | null;
  readonly content_version: number;
  readonly lease_version: number | null;
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
    ? [input.kind, input.subjectId, input.field, input.claimKey ?? null] : input.url ? [input.kind, link(input.url)] : [input.kind, input.subjectId, input.claimKey ?? null])).digest("hex")}`;
}

export const CLAIM_WORK_SQL = `WITH selected AS MATERIALIZED (
  SELECT id FROM work_row
  WHERE kind = $1 AND state = 'ready' AND not_before <= $2::timestamptz
  ORDER BY priority DESC, not_before, id
  FOR UPDATE SKIP LOCKED LIMIT $3
) UPDATE work_row w SET state = 'taken', lease_owner = $4,
    lease_until = $2::timestamptz + $5::int * interval '1 millisecond',
    lease_version = content_version, attempts = attempts + 1
  FROM selected WHERE w.id = selected.id RETURNING w.*`;

/** Expiry recovery is bounded and indexed; another claimant never waits on a dead worker's lock. */
export const EXPIRE_WORK_SQL = `WITH expired AS MATERIALIZED (
  SELECT id FROM work_row WHERE state = 'taken' AND lease_until <= $1::timestamptz
  ORDER BY lease_until, id FOR UPDATE SKIP LOCKED LIMIT $2
) UPDATE work_row w SET state = 'ready', lease_until = NULL, lease_owner = NULL, lease_version = NULL
  FROM expired WHERE w.id = expired.id RETURNING w.id`;

const ADD_WORK_SQL = `INSERT INTO work_row
  (id, kind, state, place_id, subject_id, url, sources, priority, not_before, field, value, quote, received_at)
  VALUES ($1,$2,'ready',$3,$4,$5,jsonb_build_array($6::jsonb),$7,$8,$9,$10::jsonb,$11,$8)
  ON CONFLICT (id) DO UPDATE SET
    sources = CASE WHEN work_row.sources @> EXCLUDED.sources THEN work_row.sources ELSE work_row.sources || EXCLUDED.sources END,
    content_version = work_row.content_version + CASE WHEN work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote THEN 1 ELSE 0 END,
    state = CASE WHEN work_row.state <> 'taken' AND (work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote) THEN 'ready' ELSE work_row.state END,
    not_before = CASE WHEN work_row.state <> 'taken' AND (work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote) THEN EXCLUDED.not_before ELSE work_row.not_before END,
    refusal = CASE WHEN work_row.value IS DISTINCT FROM EXCLUDED.value OR work_row.quote IS DISTINCT FROM EXCLUDED.quote THEN NULL ELSE work_row.refusal END,
    value = EXCLUDED.value, quote = EXCLUDED.quote
  RETURNING *`;

/** One SQL statement per transition; count_hour is updated by the same transaction's trigger. */
export function workList(query: Query, options: { readonly owner: string; readonly leaseMs?: number; readonly now?: () => Date }) {
  const leaseMs = options.leaseMs ?? 30_000, now = options.now ?? (() => new Date());
  if (!options.owner.trim() || !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new Error("WORK_INVALID_LEASE");

  const recover = async (limit = 1_000): Promise<number> => (await query(EXPIRE_WORK_SQL, [now().toISOString(), limit])).length;
  const fenced = (claim: WorkRow) => {
    if (claim.state !== "taken" || !claim.lease_owner) throw new Error("WORK_CLAIM_REQUIRED");
    return [claim.id, claim.lease_owner, now().toISOString()];
  };
  return {
    async add(input: WorkInput): Promise<WorkRow> {
      if (!input.placeId || !input.subjectId || !["read", "check", "load", "hunt", "detect", "audit"].includes(input.kind)
        || input.field !== undefined && !input.field.trim() || !Number.isSafeInteger(input.priority ?? 0)) throw new Error("WORK_INVALID_INPUT");
      if ((input.kind === "read" || input.kind === "load") && !input.url) throw new Error("WORK_HTTP_URL_REQUIRED");
      const [row] = await query(ADD_WORK_SQL, [workId(input), input.kind, input.placeId, input.subjectId, input.url ? link(input.url) : null,
        canonicalJson({ ...input.source, placeId: input.placeId, subjectId: input.subjectId, url: input.url ?? null }), input.priority ?? 0, now().toISOString(), input.field ?? null,
        canonicalJson(input.value ?? null), input.quote ?? null]);
      return row as unknown as WorkRow;
    },
    async claim(kind: WorkKind, n: number): Promise<readonly WorkRow[]> {
      if (!Number.isSafeInteger(n) || n < 1 || n > 1_000) throw new Error("WORK_INVALID_BATCH");
      await recover();
      return await query(CLAIM_WORK_SQL, [kind, now().toISOString(), n, `${options.owner}:${randomUUID()}`, leaseMs]) as unknown as WorkRow[];
    },
    recover,
    async finish(claim: WorkRow): Promise<boolean> {
      const [row] = await query(`UPDATE work_row SET
        state = CASE WHEN content_version = lease_version THEN 'done' ELSE 'ready' END,
        done_at = CASE WHEN content_version = lease_version THEN $3::timestamptz ELSE done_at END,
        not_before = CASE WHEN content_version <> lease_version THEN $3::timestamptz ELSE not_before END,
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND state = 'taken' AND lease_until > $3::timestamptz RETURNING state`, fenced(claim));
      return row?.state === "done";
    },
    async later(claim: WorkRow, reason: string): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [row] = await query(`UPDATE work_row SET state = 'ready', refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
        not_before = $3::timestamptz + CASE WHEN content_version <> lease_version THEN 0 ELSE least(86400000::bigint, 1000::bigint * power(2, least(attempts - 1, 17))::bigint) END * interval '1 millisecond',
        lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND state = 'taken' AND lease_until > $3::timestamptz RETURNING id`, [...fenced(claim), reason]);
      return row !== undefined;
    },
    async refuse(claim: WorkRow, reason: string): Promise<boolean> {
      if (!reason.trim()) throw new Error("WORK_REASON_REQUIRED");
      const [row] = await query(`WITH refused AS (
        UPDATE work_row SET state = CASE WHEN content_version = lease_version THEN 'refused' ELSE 'ready' END,
          refusal = CASE WHEN content_version = lease_version THEN $4 ELSE NULL END,
          refused_at = CASE WHEN content_version = lease_version THEN $3::timestamptz ELSE refused_at END,
          lease_owner = NULL, lease_until = NULL, lease_version = NULL
        WHERE id = $1 AND lease_owner = $2 AND state = 'taken' AND lease_until > $3::timestamptz RETURNING *
      ), detective AS (
        INSERT INTO work_row (id,kind,state,place_id,subject_id,url,sources,priority,not_before,field,value,quote,received_at)
        SELECT 'detect-' || id, 'detect','ready',place_id,subject_id,url,
          jsonb_build_array(jsonb_build_object('workId',id,'reason',$4,'version',content_version)),priority,$3,field,value,quote,$3
        FROM refused WHERE state = 'refused' AND kind <> 'detect'
        ON CONFLICT (id) DO UPDATE SET sources = work_row.sources || EXCLUDED.sources,
          state = CASE WHEN work_row.state = 'taken' THEN 'taken' ELSE 'ready' END,
          content_version = work_row.content_version + 1, value = EXCLUDED.value, quote = EXCLUDED.quote,
          not_before = EXCLUDED.not_before, refusal = NULL
      ) SELECT state FROM refused`, [...fenced(claim), reason]);
      return row?.state === "refused";
    },
  };
}
