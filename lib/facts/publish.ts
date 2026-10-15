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

/** Checks one claim under rulings §3 and, when it passes, decides it against the live value and writes it alone. */
export async function publishClaim(db: FactDb, c: PublishInput, clocks: Clocks, now: Date = new Date()): Promise<PublishOutcome> {
  const verdict = checkFact(c, now, clocks.windowHours);
  return db.transaction(async (query) => {
    if (!verdict.ok) {
      await openBlank(query, { entityId: c.entity.id, field: c.field, stage: "CHECK", reason: `CHECK_FAILED:${verdict.reason}`,
        detail: c.copy.finalUrl, retryMinutes: clocks.retryMinutes(c.fieldKind) });
      return { blank: verdict.reason };
    }
    const [row] = await query(`SELECT f.id, f.value, f.provenance_kind, coalesce(s.fetched_at, f.checked_at) AS fetched_at
      FROM fact f LEFT JOIN source_copy s ON s.id = f.source_copy_id
      WHERE f.entity_id = $1 AND f.field = $2 AND f.status = 'live' FOR UPDATE OF f`, [c.entity.id, c.field]);
    const decision = decide(row ? { value: row.value, provenance: row.provenance_kind as Claim["provenance"], fetchedAt: new Date(row.fetched_at as string) } : null,
      { value: c.value, provenance: c.provenance, fetchedAt: c.copy.fetchedAt });
    if (decision === "CONFIRM") {
      await query("UPDATE fact SET checked_at = $2 WHERE id = $1", [row!.id, now.toISOString()]);
      await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [c.entity.id, c.field]);
      return { decision, factId: Number(row!.id) };
    }
    const live = decision === "PUBLISH";
    if (live && row) await query("UPDATE fact SET status = 'superseded' WHERE id = $1", [row.id]);
    const [inserted] = await query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote,
        quote_start, second_copy_id, checked_at, live_at, held_reason, produced_by, cost_usd)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $5 = 'live' THEN $11::timestamptz END, $12, $13, $14)
      RETURNING id`,
    [c.entity.id, c.field, JSON.stringify(c.value), c.valueText, live ? "live" : "held", c.provenance, c.copy.id, c.quote,
      verdict.quoteStart, c.second?.copy.id ?? null, now.toISOString(),
      live ? null : decision === "FLAG_OWNER" ? "OWNER_VALUE_CONTESTED" : "LOSES_TO_CURRENT", c.producedBy, c.costUsd]);
    const factId = Number(inserted!.id);
    if (decision === "FLAG_OWNER") await query("INSERT INTO owner_flag (fact_id, kind) VALUES ($1, 'OWNER_VALUE_CONTESTED')", [factId]);
    if (live) {
      await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [c.entity.id, c.field]);
      await query(`INSERT INTO rebuild_queue (place_id) SELECT place_id FROM entity_place WHERE entity_id = $1
        ON CONFLICT (place_id) DO NOTHING`, [c.entity.id]);
    }
    return { decision, factId };
  });
}
