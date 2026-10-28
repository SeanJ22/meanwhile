import { normalizeText, type Claim, type FieldKind, type SavedCopy } from "./check.ts";
import type { Decision } from "../core/door.ts";
import { door } from "../core/door.ts";
import { enqueueReaderPlaces, type ReaderCachePurger } from "../reader/cache.ts";
import { recordFactConfirmation } from "./confirmation.ts";

export type Query = (text: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

/** One real transaction; the Neon HTTP driver cannot hold one across statements. */
export interface FactDb {
  transaction<T>(work: (query: Query) => Promise<T>): Promise<T>;
}

type BlankStage = "ACQUIRE" | "READ" | "CHECK" | "DECIDE" | "PUBLISH";

export interface Clocks {
  windowHours(kind: FieldKind): number;
  retryMinutes(kind: FieldKind): number;
}

export interface PublishInput extends Claim {
  readonly field: string;
  readonly value: unknown;
  readonly producedBy: string;
  readonly costUsd: number;
  /** Findings from a hunter or walker carry claims to check against the saved page. */
  readonly acquisition?: "loader" | "hunter" | "walker";
  /** A parsed field of an official source already held by its ordinary loader. */
  readonly sourceField?: { readonly record: Readonly<Record<string, unknown>>; readonly key: string };
}

export type PublishOutcome = { readonly decision: Decision; readonly factId: number | null } | { readonly blank: string };

export async function openBlank(query: Query, input: { readonly entityId: string; readonly field: string; readonly stage: BlankStage;
  readonly reason: string; readonly detail?: string | null; readonly retryMinutes: number; readonly countAttempt?: boolean }): Promise<void> {
  await query(`INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
    VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int), 1)
    ON CONFLICT (entity_id, field) DO UPDATE SET stage = EXCLUDED.stage, reason = EXCLUDED.reason, detail = EXCLUDED.detail,
      attempts = blank.attempts + 1, next_try_at = EXCLUDED.next_try_at, updated_at = now()
    WHERE (blank.stage,blank.reason,blank.detail) IS DISTINCT FROM (EXCLUDED.stage,EXCLUDED.reason,EXCLUDED.detail)
      OR blank.next_try_at<=now() OR $7::boolean`,
  [input.entityId, input.field, input.stage, input.reason, input.detail ?? null, Math.max(1, Math.round(input.retryMinutes)), input.countAttempt ?? false]);
}

/** Older callers retain their blank result; every fact is written by the same door. */
export async function publishClaim(db: FactDb, input: PublishInput, clocks: Clocks, now = new Date(),
  options: { readonly purge?: ReaderCachePurger } = {}): Promise<PublishOutcome> {
  const outcome = await door(db, input, clocks, now, { ...options, refusal: async (claim, reason) => {
    if (reason === "SUBJECT_NOT_FOUND") return;
    await db.transaction(query => openBlank(query, { entityId: claim.entity.id, field: claim.field, stage: "CHECK", reason: `CHECK_FAILED:${reason}`,
      detail: JSON.stringify({ sourceUrl: claim.copy.finalUrl, copyId: claim.copy.id, fieldKind: claim.fieldKind, provenance: claim.provenance,
        value: claim.value, valueText: claim.valueText, quote: claim.quote, producedBy: claim.producedBy }), retryMinutes: clocks.retryMinutes(claim.fieldKind) }));
  } });
  return "refused" in outcome ? { blank: outcome.refused } : outcome;
}

/** A source recheck records its exact live fact versions together. */
export async function restampFacts(db: FactDb, facts: readonly { readonly id: number; readonly entityId: string; readonly field: string; readonly quote: string }[],
  copy: Pick<SavedCopy, "id" | "text" | "fetchedAt">): Promise<number> {
  if (!facts.length) return 0;
  const page = normalizeText(copy.text);
  return db.transaction(async query => {
    const receipts = Object.fromEntries(facts.map(fact => {
      const start = fact.quote ? page.indexOf(normalizeText(fact.quote)) : -1;
      return [String(fact.id),{quote_start:start<0?null:start}];
    }));
    const eligible = await query(`SELECT id,entity_id,field FROM checked_fact WHERE id=ANY($1::bigint[]) AND status='live'
      AND checked_at<=$2::timestamptz AND (checked_at<$2::timestamptz OR source_copy_id IS DISTINCT FROM $3::bigint
        OR quote_start IS DISTINCT FROM ($4::jsonb->id::text->>'quote_start')::int)`,
      [facts.map(fact=>fact.id),copy.fetchedAt.toISOString(),copy.id,JSON.stringify(receipts)]);
    const changed = await recordFactConfirmation(query,{copyId:copy.id,scope:"source-recheck",at:copy.fetchedAt.toISOString(),
      factIds:eligible.map(row=>Number(row.id)),receipts});
    if (changed.length) {
      await query(`DELETE FROM blank b USING unnest($1::text[],$2::text[]) f(entity_id,field)
        WHERE b.entity_id=f.entity_id AND b.field=f.field`,[eligible.map(row=>row.entity_id),eligible.map(row=>row.field)]);
      await enqueueReaderPlaces({entities:changed},query);
    }
    return changed.length ? eligible.length : 0;
  });
}
