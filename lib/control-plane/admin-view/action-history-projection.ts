/** Unwired: not a complete read until an atomic writer and audited readiness watermark exist. Position and recordedAt come from the committed receipt row. */
import { createHash } from "node:crypto";
import { scopeKeyOf, type ExpansionScopeDecision } from "../expansion/scopes.ts";
import { receiptIdFor, type ActionReceipt } from "../gateway/contract.ts";
import { canonicalJson } from "../repository/types.ts";

export const ACTION_HISTORY_PROJECTION_VERSION = 1 as const;
export const ACTION_HISTORY_MAX_PAGE = 50;
export type ProjectedActionKind = "global-runner-pause" | "global-runner-resume";
export type UnmappedReason = "VALIDATED_ACTION_UNAVAILABLE" | "LEGACY_ACTION_UNCLASSIFIED" |
  "SCOPE_SET_V6_KIND_UNPROVEN";
export type ScopeRef = { readonly scopeKey: string; readonly instructionReceiptId: string | null;
  readonly kind: "GLOBAL" | "INSTRUCTION" };
export interface ActionHistoryProjection {
  readonly projectionVersion: typeof ACTION_HISTORY_PROJECTION_VERSION;
  readonly gatewayReceiptId: string;
  readonly gatewayType: string;
  readonly idempotencyKey: string;
  readonly sourcePosition: number;
  readonly sourceRecordedAt: string;
  readonly sourceHash: string;
  readonly actionKind: ProjectedActionKind | null;
  readonly unmappedReason: UnmappedReason | null;
  readonly scopeRefs: readonly ScopeRef[];
  readonly targetRef: string | null;
  readonly targetLabel: string | null;
  readonly effectRefs: readonly [];
}
export type ValidatedActionEvidence =
  | { readonly kind: "GLOBAL_RUNNER"; readonly type: "runner.pause" | "runner.resume" }
  | { readonly kind: "SCOPE_SET_COMMITTED"; readonly canonicalScopeKey: string;
      readonly savedDecision: ExpansionScopeDecision }
  | { readonly kind: "UNAVAILABLE"; readonly legacy: boolean };
export type CommittedReceiptEvidence = { readonly receipt: ActionReceipt; readonly sourcePosition: number;
  readonly sourceRecordedAt: string; readonly validatedAction: ValidatedActionEvidence };

function validInstant(value: string): boolean { return value.length > 0 && Number.isFinite(Date.parse(value)); }
function validId(value: string): boolean { return value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }

export function prepareActionHistoryProjection(input: CommittedReceiptEvidence): ActionHistoryProjection {
  const { receipt, sourcePosition, sourceRecordedAt, validatedAction } = input;
  if (!Number.isSafeInteger(sourcePosition) || sourcePosition < 0 || !validInstant(sourceRecordedAt) ||
    !validId(receipt.receiptId) || receipt.receiptId !== receiptIdFor(receipt.type, receipt.idempotencyKey) ||
    !validInstant(receipt.startedAt)) throw new Error("INVALID_CANONICAL_ACTION_RECEIPT");
  const base = {
    projectionVersion: ACTION_HISTORY_PROJECTION_VERSION,
    gatewayReceiptId: receipt.receiptId, gatewayType: receipt.type,
    idempotencyKey: receipt.idempotencyKey, sourcePosition, sourceRecordedAt,
    sourceHash: createHash("sha256").update(canonicalJson(receipt)).digest("hex"),
    effectRefs: [] as const,
  };
  if (validatedAction.kind === "GLOBAL_RUNNER") {
    if (validatedAction.type !== receipt.type || receipt.subjectKind !== "the standing runner")
      throw new Error("ACTION_HISTORY_VALIDATION_MISMATCH");
    return { ...base, actionKind: receipt.type === "runner.pause" ? "global-runner-pause" : "global-runner-resume",
      unmappedReason: null, scopeRefs: [{ scopeKey: "us", instructionReceiptId: null, kind: "GLOBAL" }],
      targetRef: "runner", targetLabel: "the standing runner" };
  }
  if (validatedAction.kind === "SCOPE_SET_COMMITTED") {
    const decision = validatedAction.savedDecision;
    if (receipt.type !== "expansion.scope.set" || receipt.outcome !== "DONE" ||
      decision.key !== validatedAction.canonicalScopeKey || decision.key !== scopeKeyOf(decision.geography) ||
      receipt.subject !== decision.key ||
      decision.latestDecisionReceiptId !== receipt.receiptId || !validId(decision.receiptId))
      throw new Error("ACTION_HISTORY_VALIDATION_MISMATCH");
    return { ...base, actionKind: null, unmappedReason: "SCOPE_SET_V6_KIND_UNPROVEN",
      scopeRefs: [{ scopeKey: decision.key, instructionReceiptId: decision.receiptId, kind: "INSTRUCTION" }],
      targetRef: decision.key, targetLabel: decision.geography.label };
  }
  return { ...base, actionKind: null,
    unmappedReason: validatedAction.legacy ? "LEGACY_ACTION_UNCLASSIFIED" : "VALIDATED_ACTION_UNAVAILABLE",
    scopeRefs: [], targetRef: null, targetLabel: null };
}

export type ProjectionReadiness = { readonly status: "READY" | "INCOMPLETE";
  readonly throughPosition: number; readonly sourceCount: number; readonly projectedCount: number;
  readonly sourceSetHash: string };
export type ProjectionPageQuery = { readonly scopeKey: string; readonly instructionReceiptId?: string | null;
  readonly afterPosition?: number | null; readonly limit?: number };
export type ProjectionPage = { readonly available: boolean; readonly reason: string | null;
  readonly rows: readonly ActionHistoryProjection[]; readonly nextPosition: number | null;
  /** Null while any source receipt lacks a provable scope, even if the source window itself is complete. */
  readonly total: number | null };

export function actionHistorySourceSetHash(rows: readonly Pick<ActionHistoryProjection, "sourcePosition" | "gatewayReceiptId">[]): string {
  const pairs = rows.map(row => [row.sourcePosition, row.gatewayReceiptId] as const)
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

/** Pure reader for a proven complete source window. Never turns missing rows into a zero total. */
export function selectActionHistoryProjection(
  rows: readonly ActionHistoryProjection[], readiness: ProjectionReadiness | null, query: ProjectionPageQuery,
): ProjectionPage {
  if (!readiness || readiness.status !== "READY" || readiness.sourceCount !== readiness.projectedCount ||
    !Number.isSafeInteger(readiness.throughPosition) || readiness.throughPosition < 0 ||
    readiness.projectedCount !== rows.length || new Set(rows.map(row => row.gatewayReceiptId)).size !== rows.length ||
    new Set(rows.map(row => row.sourcePosition)).size !== rows.length ||
    readiness.sourceSetHash !== actionHistorySourceSetHash(rows))
    return { available: false, reason: "PROJECTION_NOT_COMPLETE", rows: [], nextPosition: null, total: null };
  if (!validId(query.scopeKey) || (query.instructionReceiptId !== undefined && query.instructionReceiptId !== null &&
    !validId(query.instructionReceiptId)) || (query.afterPosition !== undefined && query.afterPosition !== null &&
    (!Number.isSafeInteger(query.afterPosition) || query.afterPosition < -1))) throw new Error("INVALID_HISTORY_PROJECTION_QUERY");
  if (query.scopeKey !== "us" && !query.instructionReceiptId) throw new Error("INSTRUCTION_RECEIPT_REQUIRED");
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(ACTION_HISTORY_MAX_PAGE, query.limit!)) : ACTION_HISTORY_MAX_PAGE;
  const matching = rows.filter(row => row.sourcePosition <= readiness.throughPosition &&
    row.scopeRefs.some(ref => ref.scopeKey === query.scopeKey &&
      (query.instructionReceiptId === undefined || query.instructionReceiptId === null ||
        ref.instructionReceiptId === query.instructionReceiptId)))
    .sort((a, b) => a.sourcePosition - b.sourcePosition || a.gatewayReceiptId.localeCompare(b.gatewayReceiptId));
  const after = query.afterPosition ?? -1;
  const visible = matching.filter(row => row.sourcePosition > after);
  const page = visible.slice(0, limit);
  return { available: true, reason: null, rows: page,
    nextPosition: visible.length > page.length ? page.at(-1)!.sourcePosition : null,
    total: rows.some(row => row.scopeRefs.length === 0) ? null : matching.length };
}
