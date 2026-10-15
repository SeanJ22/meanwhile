import { checkFact, type Claim, type FieldKind } from "./check.ts";
import { decide, type Decision } from "./decide.ts";

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

export async function publishClaims(db: FactDb, claims: readonly PublishInput[], clocks: Clocks, now: Date = new Date()): Promise<PublishOutcome[]> {
  const outcomes: PublishOutcome[] = [];
  for (let at = 0; at < claims.length;) {
    const batch: PublishInput[] = [], keys = new Set<string>();
    while (at < claims.length && batch.length < 100) {
      const claim = claims[at]!, key = JSON.stringify([claim.entity.id, claim.field]);
      if (keys.has(key)) break;
      keys.add(key); batch.push(claim); at++;
    }
    const checked = batch.map(claim => checkFact(claim, now, clocks.windowHours));
    outcomes.push(...await db.transaction(async query => {
      // Entity locks also serialize first publication, when no live fact exists to lock yet.
      await query("SELECT id FROM entity WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE", [[...new Set(batch.map(c => c.entity.id))]]);
      const current = await query(`SELECT f.id, f.entity_id, f.field, f.value, f.provenance_kind,
          coalesce(s.fetched_at, f.checked_at) AS fetched_at
        FROM unnest($1::text[], $2::text[]) AS wanted(entity_id, field)
        JOIN fact f ON f.entity_id = wanted.entity_id AND f.field = wanted.field AND f.status = 'live'
        LEFT JOIN source_copy s ON s.id = f.source_copy_id FOR UPDATE OF f`, [batch.map(c => c.entity.id), batch.map(c => c.field)]);
      const held = new Map(current.map(row => [JSON.stringify([row.entity_id, row.field]), row]));
      const writes = batch.map((c, i) => {
        const verdict = checked[i]!, row = held.get(JSON.stringify([c.entity.id, c.field]));
        const decision = verdict.ok ? decide(row ? { value: row.value, provenance: row.provenance_kind as Claim["provenance"],
          fetchedAt: new Date(row.fetched_at as string) } : null, { value: c.value, provenance: c.provenance, fetchedAt: c.copy.fetchedAt }) : null;
        return { entity_id: c.entity.id, field: c.field, value: c.value, value_text: c.valueText, decision, current_id: row?.id ?? null,
          provenance: c.provenance, copy_id: c.copy.id, quote: c.quote, quote_start: verdict.ok ? verdict.quoteStart : null,
          second_id: c.second?.copy.id ?? null, produced_by: c.producedBy, cost_usd: c.costUsd,
          failure: verdict.ok ? null : verdict.reason, detail: c.copy.finalUrl, retry: Math.max(1, Math.round(clocks.retryMinutes(c.fieldKind))) };
      });
      const saved = await query(`WITH incoming AS MATERIALIZED (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(entity_id text, field text, value jsonb, value_text text,
            decision text, current_id bigint, provenance text, copy_id bigint, quote text, quote_start int, second_id bigint,
            produced_by text, cost_usd numeric, failure text, detail text, retry int)
        ), updated AS (
          UPDATE fact f SET status = CASE WHEN x.decision = 'PUBLISH' THEN 'superseded' ELSE f.status END,
            checked_at = CASE WHEN x.decision = 'CONFIRM' THEN greatest(f.checked_at, $2::timestamptz) ELSE f.checked_at END
          FROM incoming x WHERE f.id = x.current_id AND x.decision IN ('PUBLISH', 'CONFIRM') RETURNING f.id
        ), inserted AS (
          INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote,
            quote_start, second_copy_id, checked_at, live_at, held_reason, produced_by, cost_usd)
          SELECT x.entity_id, x.field, x.value, x.value_text, CASE WHEN x.decision = 'PUBLISH' THEN 'live' ELSE 'held' END,
            x.provenance, x.copy_id, x.quote, x.quote_start, x.second_id, $2::timestamptz,
            CASE WHEN x.decision = 'PUBLISH' THEN $2::timestamptz END,
            CASE WHEN x.decision = 'FLAG_OWNER' THEN 'OWNER_VALUE_CONTESTED' WHEN x.decision = 'KEEP_CURRENT' THEN 'LOSES_TO_CURRENT' END,
            x.produced_by, x.cost_usd
          FROM incoming x CROSS JOIN (SELECT count(*) FROM updated) done WHERE x.decision <> 'CONFIRM'
          RETURNING id, entity_id, field, held_reason
        ), flags AS (
          INSERT INTO owner_flag (fact_id, kind) SELECT id, 'OWNER_VALUE_CONTESTED' FROM inserted WHERE held_reason = 'OWNER_VALUE_CONTESTED'
        ), cleared AS (
          DELETE FROM blank b USING incoming x WHERE b.entity_id = x.entity_id AND b.field = x.field AND x.decision IN ('PUBLISH', 'CONFIRM')
        ), blanks AS (
          INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
          SELECT entity_id, field, 'CHECK', 'CHECK_FAILED:' || failure, detail, now() + make_interval(mins => retry), 1
          FROM incoming WHERE failure IS NOT NULL
          ON CONFLICT (entity_id, field) DO UPDATE SET stage = EXCLUDED.stage, reason = EXCLUDED.reason, detail = EXCLUDED.detail,
            attempts = blank.attempts + 1, next_try_at = EXCLUDED.next_try_at, updated_at = now()
        ), rebuilds AS (
          INSERT INTO rebuild_queue (place_id) SELECT DISTINCT ep.place_id FROM incoming x
          JOIN entity_place ep ON ep.entity_id = x.entity_id WHERE x.decision = 'PUBLISH' ON CONFLICT (place_id) DO NOTHING
        ) SELECT id, entity_id, field FROM inserted`, [JSON.stringify(writes), now.toISOString()]);
      const ids = new Map(saved.map(row => [JSON.stringify([row.entity_id, row.field]), Number(row.id)]));
      return writes.map(row => row.failure ? { blank: row.failure } : { decision: row.decision!,
        factId: row.decision === "CONFIRM" ? Number(row.current_id) : ids.get(JSON.stringify([row.entity_id, row.field]))! });
    }));
  }
  return outcomes;
}

export async function publishClaim(db: FactDb, claim: PublishInput, clocks: Clocks, now: Date = new Date()): Promise<PublishOutcome> {
  return (await publishClaims(db, [claim], clocks, now))[0]!;
}
