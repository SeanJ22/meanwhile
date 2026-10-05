/** Postgres-only receipt + Admin history companion append.
 *
 * The existing generic append repository uses separate HTTP statements for
 * position allocation and receipt insertion. It cannot make a second table
 * write atomic. This function uses one parameterized, data-modifying SQL
 * statement, so Postgres commits or rolls back receipt, companion, scope ref,
 * and readiness invalidation together. The v16 provider routes gateway receipts
 * through this path after its normal schema bootstrap.
 */
import type { ActionReceipt } from "../gateway/contract.ts";
import { prepareActionHistoryProjection, type ValidatedActionEvidence } from "../admin-view/action-history-projection.ts";
import { canonicalJson } from "./types.ts";
import { boundedQuery, type ControlPlaneRequestBounds } from "./request-bounds.ts";
import type { Sql } from "./pg-store.ts";

export interface ActionHistoryReadQuery { readonly scope: string; readonly beforePosition?: number | null; readonly limit: number; }
export interface ActionHistoryReadRow { readonly position: number; readonly receipt: ActionReceipt; }
export const ACTION_HISTORY_PAGE_SQL = `
SELECT p.source_position AS position, a.record
FROM cp_admin_action_history_projection p
JOIN cp_log_admin_receipts a ON a.log_key = p.gateway_log_key AND a.record_id = p.gateway_receipt_id
WHERE ($1 = 'us'
  OR COALESCE(NULLIF(a.record->>'requestedSubject', ''), a.record->>'subject') = $1
  OR a.record->>'subject' = $1
  OR EXISTS (SELECT 1 FROM cp_admin_action_history_scope_ref s
    WHERE s.gateway_receipt_id = p.gateway_receipt_id AND s.scope_key = $1))
  AND ($2::bigint IS NULL OR p.source_position < $2::bigint)
ORDER BY p.source_position DESC
LIMIT $3`;

export async function readActionHistoryPage(sql: Sql, query: ActionHistoryReadQuery, bounds?: ControlPlaneRequestBounds): Promise<readonly ActionHistoryReadRow[]> {
  if (!query.scope || query.scope.length > 256 || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 51 ||
    query.beforePosition != null && (!Number.isSafeInteger(query.beforePosition) || query.beforePosition < 0)) throw new Error("INVALID_HISTORY_QUERY");
  const result = await boundedQuery(sql, { operation: "cp_admin_action_history.page", callClass: "PAGE" },
    ACTION_HISTORY_PAGE_SQL, [query.scope, query.beforePosition ?? null, query.limit], bounds ? { bounds } : {});
  return rows(result).map(row => ({ position: integer(row.position),
    receipt: (typeof row.record === "string" ? JSON.parse(row.record) : row.record) as ActionReceipt }));
}

/** One SQL statement; the CTE dependency chain is receipt -> projection -> scope. */
export const ATOMIC_ACTION_HISTORY_INSERT_SQL = `
WITH allocated AS (
  INSERT INTO cp_log_heads (log_table, log_key, next_position)
  VALUES ('cp_log_admin_receipts', 'admin-action', 1)
  ON CONFLICT (log_table, log_key)
    DO UPDATE SET next_position = cp_log_heads.next_position + 1
  RETURNING next_position - 1 AS position
), receipt_insert AS (
  INSERT INTO cp_log_admin_receipts (log_key, record_id, position, recorded_at, record)
  SELECT 'admin-action', $1, a.position, $2::timestamptz, $3::jsonb FROM allocated a
  ON CONFLICT (log_key, record_id) DO NOTHING
  RETURNING position
), projected AS (
  INSERT INTO cp_admin_action_history_projection
    (gateway_receipt_id, gateway_log_key, projection_version, gateway_type,
     idempotency_key, source_position, source_recorded_at, source_hash,
     mapping_state, action_kind, unmapped_reason, target_ref, target_label)
  SELECT $1, 'admin-action', 1, $4, $5, r.position, $2::timestamptz, $6,
         $7, $8, $9, $10, $11 FROM receipt_insert r
  RETURNING gateway_receipt_id
), scoped AS (
  INSERT INTO cp_admin_action_history_scope_ref
    (gateway_receipt_id, scope_key, instruction_receipt_id, scope_kind)
  SELECT p.gateway_receipt_id, $12, $13, $14 FROM projected p WHERE $12::text IS NOT NULL
  RETURNING gateway_receipt_id
), readiness_dirty AS (
  UPDATE cp_admin_action_history_readiness SET status = 'INCOMPLETE'
  WHERE singleton = true AND status = 'READY' AND EXISTS (SELECT 1 FROM projected)
  RETURNING status
)
SELECT r.position, (SELECT count(*) FROM projected) AS projected_count,
       (SELECT count(*) FROM scoped) AS scoped_count
FROM receipt_insert r`;

export const ATOMIC_ACTION_HISTORY_READBACK_SQL = `
SELECT a.position, a.recorded_at, a.record,
       p.projection_version, p.gateway_type, p.idempotency_key,
       p.source_position, p.source_recorded_at, p.source_hash,
       p.mapping_state, p.action_kind, p.unmapped_reason, p.target_ref, p.target_label,
       s.scope_key, s.instruction_receipt_id, s.scope_kind
FROM cp_log_admin_receipts a
LEFT JOIN cp_admin_action_history_projection p ON p.gateway_receipt_id = a.record_id
LEFT JOIN cp_admin_action_history_scope_ref s ON s.gateway_receipt_id = p.gateway_receipt_id
WHERE a.log_key = 'admin-action' AND a.record_id = $1`;

export type AtomicActionHistoryOutcome = { readonly state: "APPENDED" | "REPLAYED" | "LEGACY_UNPROJECTED";
  readonly position: number };
export class AtomicActionHistoryUnconfirmed extends Error {
  readonly code = "ATOMIC_ACTION_HISTORY_UNCONFIRMED";
  constructor() { super("Atomic action-history write could not be confirmed; inspect the receipt before retrying the action."); }
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new AtomicActionHistoryUnconfirmed();
  return value as Record<string, unknown>[];
}
function integer(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new AtomicActionHistoryUnconfirmed();
  return n;
}
function instant(value: unknown): number {
  const n = Date.parse(value instanceof Date ? value.toISOString() : String(value));
  if (!Number.isFinite(n)) throw new AtomicActionHistoryUnconfirmed();
  return n;
}
function valueOf(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

/** No fallback to generic append and no blind retry after an ambiguous transport error. */
export async function appendActionReceiptWithHistoryAtomic(input: {
  readonly sql: Sql;
  readonly receipt: ActionReceipt;
  readonly sourceRecordedAt: string;
  readonly validatedAction: ValidatedActionEvidence;
  readonly bounds?: ControlPlaneRequestBounds;
}): Promise<AtomicActionHistoryOutcome> {
  const planned = prepareActionHistoryProjection({ receipt: input.receipt, sourcePosition: 0,
    sourceRecordedAt: input.sourceRecordedAt, validatedAction: input.validatedAction });
  const scope = planned.scopeRefs[0] ?? null;
  const mappingState = planned.actionKind ? "MAPPED" : scope ? "SCOPE_KNOWN_KIND_UNMAPPED" : "UNMAPPED";
  const run = (operation: string, query: string, params: readonly unknown[]) =>
    boundedQuery(input.sql, { operation: `cp_admin_action_history.${operation}`, callClass: "POINT" },
      query, params, input.bounds ? { bounds: input.bounds } : {});
  let inserted: readonly Record<string, unknown>[] = [];
  let insertError = false;
  try {
    inserted = rows(await run("append", ATOMIC_ACTION_HISTORY_INSERT_SQL, [
      input.receipt.receiptId, input.sourceRecordedAt, JSON.stringify(input.receipt),
      planned.gatewayType, planned.idempotencyKey, planned.sourceHash, mappingState,
      planned.actionKind, planned.unmappedReason, planned.targetRef, planned.targetLabel,
      scope?.scopeKey ?? null, scope?.instructionReceiptId ?? null, scope?.kind ?? null,
    ]));
    if (inserted.length > 1 || (inserted.length === 1 &&
      (integer(inserted[0].projected_count) !== 1 || integer(inserted[0].scoped_count) !== (scope ? 1 : 0))))
      throw new AtomicActionHistoryUnconfirmed();
  } catch {
    // Even a request timeout can race a commit. Read back once; never resend.
    insertError = true;
  }
  let held: readonly Record<string, unknown>[];
  try { held = rows(await run("readback", ATOMIC_ACTION_HISTORY_READBACK_SQL, [input.receipt.receiptId])); }
  catch { throw new AtomicActionHistoryUnconfirmed(); }
  if (held.length === 0) throw new AtomicActionHistoryUnconfirmed();
  const first = held[0];
  const position = integer(first.position);
  let canonical = first.record;
  if (typeof canonical === "string") {
    try { canonical = JSON.parse(canonical); }
    catch { throw new AtomicActionHistoryUnconfirmed(); }
  }
  if (canonicalJson(canonical) !== canonicalJson(input.receipt) ||
    (inserted.length > 0 && instant(first.recorded_at) !== instant(input.sourceRecordedAt)))
    throw new AtomicActionHistoryUnconfirmed();
  if (first.projection_version === null || first.projection_version === undefined) {
    if (inserted.length > 0 || insertError) throw new AtomicActionHistoryUnconfirmed();
    return { state: "LEGACY_UNPROJECTED", position };
  }
  if (held.length !== 1 || integer(first.projection_version) !== 1 ||
    integer(first.source_position) !== position || instant(first.source_recorded_at) !== instant(first.recorded_at) ||
    valueOf(first, "gateway_type") !== planned.gatewayType ||
    valueOf(first, "idempotency_key") !== planned.idempotencyKey ||
    valueOf(first, "source_hash") !== planned.sourceHash ||
    valueOf(first, "mapping_state") !== mappingState || valueOf(first, "action_kind") !== planned.actionKind ||
    valueOf(first, "unmapped_reason") !== planned.unmappedReason || valueOf(first, "target_ref") !== planned.targetRef ||
    valueOf(first, "target_label") !== planned.targetLabel ||
    valueOf(first, "scope_key") !== (scope?.scopeKey ?? null) ||
    valueOf(first, "instruction_receipt_id") !== (scope?.instructionReceiptId ?? null) ||
    valueOf(first, "scope_kind") !== (scope?.kind ?? null))
    throw new AtomicActionHistoryUnconfirmed();
  return { state: inserted.length > 0 ? "APPENDED" : "REPLAYED", position };
}
