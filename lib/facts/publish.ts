import { normalizeText, type Claim, type FieldKind, type SavedCopy } from "./check.ts";
import type { Decision } from "../core/door.ts";
import { door } from "../core/door.ts";
import type { ReaderCachePurger } from "../reader/cache.ts";

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
}

export type PublishOutcome = { readonly decision: Decision; readonly factId: number | null } | { readonly blank: string };

export async function openBlank(query: Query, input: { readonly entityId: string; readonly field: string; readonly stage: BlankStage;
  readonly reason: string; readonly detail?: string | null; readonly retryMinutes: number }): Promise<void> {
  await query(`INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
    VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int), 1)
    ON CONFLICT (entity_id, field) DO UPDATE SET stage = EXCLUDED.stage, reason = EXCLUDED.reason, detail = EXCLUDED.detail,
      attempts = blank.attempts + 1, next_try_at = EXCLUDED.next_try_at, updated_at = now()`,
  [input.entityId, input.field, input.stage, input.reason, input.detail ?? null, Math.max(1, Math.round(input.retryMinutes))]);
}

/** Older callers retain their blank result; every fact is written by the same door. */
export async function publishClaim(db: FactDb, input: PublishInput, clocks: Clocks, now = new Date(),
  options: { readonly purge?: ReaderCachePurger } = {}): Promise<PublishOutcome> {
  const outcome = await door(db, input, clocks, now, { ...options, refusal: async (query, claim, reason) => {
    if (reason === "SUBJECT_NOT_FOUND") return;
    await openBlank(query, { entityId: claim.entity.id, field: claim.field, stage: "CHECK", reason: `CHECK_FAILED:${reason}`,
      detail: JSON.stringify({ sourceUrl: claim.copy.finalUrl, copyId: claim.copy.id, fieldKind: claim.fieldKind, provenance: claim.provenance,
        value: claim.value, valueText: claim.valueText, quote: claim.quote, producedBy: claim.producedBy }), retryMinutes: clocks.retryMinutes(claim.fieldKind) });
  } });
  return "refused" in outcome ? { blank: outcome.refused } : outcome;
}

/** A live value seen again on a fresh saved copy: its checked date and receipt move to that copy. Its blank closes. */
async function restamp(query: Query, fact: { readonly id: unknown; readonly entityId: string; readonly field: string }, at: Date,
  receipt: { readonly copyId: number; readonly quoteStart: number | null }): Promise<boolean> {
  if (!(await query(`UPDATE fact SET checked_at = greatest(checked_at, $2::timestamptz), source_copy_id = $3, quote_start = $4
    WHERE id = $1 AND status = 'live' RETURNING id`, [fact.id, at.toISOString(), receipt.copyId, receipt.quoteStart])).length) return false;
  await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [fact.entityId, fact.field]);
  return true;
}

/** Live facts a fresh read of their page still shows: each one's checked date and receipt move to that saved copy. Returns how many moved. */
export async function restampFacts(db: FactDb, facts: readonly { readonly id: number; readonly entityId: string; readonly field: string; readonly quote: string }[],
  copy: Pick<SavedCopy, "id" | "text" | "fetchedAt">): Promise<number> {
  if (!facts.length) return 0;
  const page = normalizeText(copy.text);
  return db.transaction(async query => {
    let count = 0;
    for (const fact of facts) {
      const start = fact.quote ? page.indexOf(normalizeText(fact.quote)) : -1;
      if (!await restamp(query, fact, copy.fetchedAt, { copyId: copy.id, quoteStart: start < 0 ? null : start })) continue;
      count++;
    }
    return count;
  });
}
