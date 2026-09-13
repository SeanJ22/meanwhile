/**
 * Immutable historical promoter/1 receipt contract. No imports or executable producer dependencies.
 * These shapes describe retained evidence only; they neither authorize publication nor describe
 * the permanent civic data plane's receipts. Keep this leaf when the legacy producer is removed.
 */
export const PROMOTER_VERSION = "promoter/1";
export const RECEIPTS_DIR = ["data", "health", "promotion-receipts"] as const;

export interface PromotionAuthority {
  readonly enabled: boolean;
  readonly openRecordClasses: readonly string[];
  readonly basis: "LIVE_ACTIVATION_GATE" | "SHADOW_CANARY_AS_IF";
  readonly reason: string;
}

/** Frozen nested wire shapes: independent of evolving window and Reader implementations. */
export type HistoricalReaderChangeKind = "ADD" | "REPLACE" | "UNCHANGED";
export interface HistoricalVerificationVerdict {
  readonly instrument: string;
  readonly exitCode: number | null;
  readonly passed: boolean | null;
  readonly detail: string;
}
export type HistoricalRegressionAction = "NONE" | "REVERT_AND_INCIDENT" | "INCIDENT_WITHOUT_REVERT";
export interface HistoricalWindowIncident {
  readonly formatVersion: 1;
  readonly incidentId: string;
  readonly windowId: string;
  readonly stage: "LEGACY_REFRESH" | "PIPELINE_EVALUATION" | "POST_PROMOTION_VERIFICATION" | "DIGEST" | "LOCK" | "PROMOTION";
  readonly code: string;
  readonly detail: string;
  readonly openedAt: string;
  readonly missedScope: readonly string[];
}

export type PromotionTarget = { readonly kind: "SHADOW"; readonly root: string } | { readonly kind: "READER"; readonly root: string };

export const PROMOTION_REFUSALS = [
  "PROMOTION_OFF",
  "SHADOW_AUTHORITY_CANNOT_TARGET_READER",
  "NOT_PROMOTE_WOULD",
  "RECORD_CLASS_CLOSED",
  "RECORD_CLASS_NOT_A_MEETING_FACT",
  "FACT_NOT_LOADED",
  "FACT_HELD",
  /** An agenda for a sitting the Reader does not serve and this batch does not promote the time of. */
  "AGENDA_WITHOUT_SITTING",
  "NO_CURRENT_SNAPSHOT",
  "PROJECTION_INVALID",
] as const;
export type PromotionRefusalCode = (typeof PROMOTION_REFUSALS)[number];

export interface PromotionRefusal {
  readonly itemId: string;
  readonly recordClass: string;
  readonly code: PromotionRefusalCode;
  readonly detail: string;
}

export interface PromotionReceipt {
  readonly formatVersion: 1;
  readonly version: typeof PROMOTER_VERSION;
  readonly receiptId: string;
  readonly at: string;
  readonly windowId: string | null;
  readonly target: PromotionTarget;
  readonly authority: PromotionAuthority;
  readonly items: readonly { readonly itemId: string; readonly recordClass: string; readonly factKey: string; readonly meetingId: string; readonly change: HistoricalReaderChangeKind; readonly changedFields: readonly string[] }[];
  readonly refused: readonly PromotionRefusal[];
  readonly before: { readonly path: string; readonly existed: boolean; readonly sha256: string | null; readonly copy: string | null };
  readonly after: { readonly sha256: string | null; readonly meetings: number | null; readonly written: boolean };
  readonly verification: HistoricalVerificationVerdict | null;
  readonly regression: { readonly action: HistoricalRegressionAction; readonly reason: string } | null;
  readonly reversal: { readonly executed: boolean; readonly at: string | null; readonly restoredSha256: string | null; readonly matchesBefore: boolean | null; readonly detail: string } | null;
  readonly incident: HistoricalWindowIncident | null;
  readonly receiptPath: string | null;
  readonly lines: readonly string[];
}

/** The window record's summary of one receipt. */
export function receiptSummary(receipt: PromotionReceipt): { receiptId: string; target: "SHADOW" | "READER"; promoted: number; refused: number; reverted: boolean; incidentId: string | null; path: string | null } {
  return { receiptId: receipt.receiptId, target: receipt.target.kind, promoted: receipt.items.length, refused: receipt.refused.length,
    reverted: receipt.reversal?.executed === true && receipt.reversal.matchesBefore === true, incidentId: receipt.incident?.incidentId ?? null, path: receipt.receiptPath };
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const nullableString = (value: unknown) => value === null || string(value);
export const isHistoricalReceiptTimestamp = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || isHistoricalReceiptTimestamp(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);
const nullableCount = (value: unknown) => value === null || (integer(value) && (value as number) >= 0);
const hash = (value: unknown) => value === null || (string(value) && /^[a-f0-9]{64}$/.test(value));
const boolean = (value: unknown) => typeof value === "boolean";
const oneOf = (value: unknown, values: readonly string[]) => string(value) && values.includes(value);

/** Shape validation only. Failed/refused/reversed receipts remain reportable evidence, never upgraded. */
export function isHistoricalPromotionReceipt(value: unknown): value is PromotionReceipt {
  if (!object(value)) return false;
  const r = value, a = r.authority, b = r.before, after = r.after;
  if (r.formatVersion !== 1 || r.version !== PROMOTER_VERSION || !string(r.receiptId) || !isHistoricalReceiptTimestamp(r.at) || !nullableString(r.windowId) ||
    !object(r.target) || !oneOf(r.target.kind, ["READER", "SHADOW"]) || !string(r.target.root) || !object(a) ||
    !boolean(a.enabled) || !strings(a.openRecordClasses) || !oneOf(a.basis, ["LIVE_ACTIVATION_GATE", "SHADOW_CANARY_AS_IF"]) || !string(a.reason) ||
    !Array.isArray(r.items) || !r.items.every(item => object(item) && [item.itemId, item.recordClass, item.factKey, item.meetingId].every(string) &&
      oneOf(item.change, ["ADD", "REPLACE", "UNCHANGED"]) && strings(item.changedFields)) ||
    !Array.isArray(r.refused) || !r.refused.every(item => object(item) && [item.itemId, item.recordClass, item.detail].every(string) && oneOf(item.code, PROMOTION_REFUSALS)) ||
    !object(b) || !string(b.path) || !boolean(b.existed) || !hash(b.sha256) || !nullableString(b.copy) ||
    !object(after) || !hash(after.sha256) || !nullableCount(after.meetings) || !boolean(after.written) || !nullableString(r.receiptPath) || !strings(r.lines)) return false;
  const v = r.verification;
  if (v !== null && (!object(v) || !string(v.instrument) || !(v.exitCode === null || integer(v.exitCode)) ||
    !(v.passed === null || boolean(v.passed)) || !string(v.detail))) return false;
  const g = r.regression;
  if (g !== null && (!object(g) || !oneOf(g.action, ["NONE", "REVERT_AND_INCIDENT", "INCIDENT_WITHOUT_REVERT"]) || !string(g.reason))) return false;
  const reversal = r.reversal;
  if (reversal !== null && (!object(reversal) || !boolean(reversal.executed) || !nullableTimestamp(reversal.at) ||
    !hash(reversal.restoredSha256) || !(reversal.matchesBefore === null || boolean(reversal.matchesBefore)) || !string(reversal.detail))) return false;
  const incident = r.incident;
  return incident === null || (object(incident) && incident.formatVersion === 1 && [incident.incidentId, incident.windowId, incident.code, incident.detail].every(string) &&
    oneOf(incident.stage, ["LEGACY_REFRESH", "PIPELINE_EVALUATION", "POST_PROMOTION_VERIFICATION", "DIGEST", "LOCK", "PROMOTION"]) && isHistoricalReceiptTimestamp(incident.openedAt) && strings(incident.missedScope));
}
