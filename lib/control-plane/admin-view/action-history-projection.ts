/** Unwired: not a complete read until an atomic writer and audited readiness watermark exist. Position and recordedAt come from the committed receipt row. */
import { createHash } from "node:crypto";
import { scopeKeyOf, type ExpansionScopeDecision } from "../expansion/scopes.ts";
import { receiptIdFor, type ActionReceipt } from "../gateway/contract.ts";
import { canonicalJson } from "../repository/types.ts";

export const ACTION_HISTORY_PROJECTION_VERSION = 1 as const;
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

