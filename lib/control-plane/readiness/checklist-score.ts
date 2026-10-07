import profile from "./checklist-profile.json" with { type: "json" };

/** Receipt projection only: this module neither creates work nor owns civic data. */
export const CHECKLIST_PROFILE = profile;
export const CHECKLIST_SCORE_VERSION = "checklist-score/1";
/** These clause IDs bind the complete original wording, including shared-row
 * residuals. A caller cannot shrink the burden to a convenient field. */
export function checklistRequiredClauses(predicateKey: string): readonly string[] {
  return profile.definitions.filter(d=>d.canonicalPredicate===predicateKey&&!d.policyOverride).map(d=>`${profile.version}:${d.id}`);
}
export type ChecklistDimension = "CIVIC_FULL_TARGET" | "ANSWER_READINESS" | "OPERATIONAL_READINESS" | "DELIVERY_READINESS" | "PARTICIPATION_READINESS" | "GATES";
export type RequirementDisposition = "DELIVERED" | "PARTIALLY_DELIVERED" | "STALE" | "MISSING_CAPABILITY" | "DISCONNECTED_CAPABILITY" | "EXECUTION_FAILURE" | "SOURCE_LIMITATION" | "UNCERTAIN_APPLICABILITY" | "NOT_APPLICABLE" | "NOT_YET_DUE" | "SUPERSEDED";
export interface ChecklistDecision {
  readonly state: "REQUIRED" | "NOT_APPLICABLE" | "UNRESOLVED";
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}
export interface ChecklistInstance {
  readonly obligationKey: string;
  readonly definitionIds: readonly string[];
  readonly predicateKey: string;
  readonly objectId: string;
  readonly jurisdictionId: string;
  readonly period: string;
  readonly scopeRevision: string;
  readonly applicability: ChecklistDecision;
  readonly due: { readonly state: "DUE_NOW" | "NOT_YET_DUE" | "UNRESOLVED"; readonly evidenceIds: readonly string[]; readonly at: string | null };
  /** Required clauses are declared before execution, including broad-row residuals. */
  readonly predicate: { readonly kind: "POSSESSION" | "ESTABLISH_ABSENCE" | "CAPABILITY"; readonly requiredClauses: readonly string[]; readonly contractVersion: string };
  readonly workIds: readonly string[];
  readonly requiredSurfaces: readonly string[];
  readonly requiresFreshness: boolean;
  readonly owner: string;
  readonly blocker: string | null;
  readonly nextAction: string;
  readonly failureKind?: Exclude<RequirementDisposition, "DELIVERED" | "NOT_APPLICABLE" | "NOT_YET_DUE" | "SUPERSEDED">;
}
export interface ChecklistWitness {
  readonly id: string;
  readonly obligationKey: string;
  readonly objectId: string;
  readonly jurisdictionId: string;
  readonly period: string;
  readonly predicateKey: string;
  readonly contractVersion: string;
  readonly recordedAt: string;
  readonly sourcePublication: "PUBLISHED" | "NOT_PUBLISHED" | "UNKNOWN";
  readonly acquisition: "PRESENT" | "ABSENT" | "FAILED" | "UNKNOWN";
  readonly sourceIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly contentHashes: readonly string[];
  readonly attemptIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly verification: "PASS" | "FAIL" | "UNPROVED";
  readonly satisfiedClauses: readonly string[];
  readonly conflict: boolean;
  readonly freshness: { readonly ruleId: string | null; readonly validUntil: string | null };
  readonly publication: { readonly state: "ACCEPTED" | "HELD" | "NONE"; readonly candidateId: string | null; readonly version: string | null; readonly receiptId: string | null; readonly at: string | null };
  readonly surfaces: readonly { readonly surfaceId: string; readonly version: string; readonly objectId: string; readonly jurisdictionId: string; readonly period: string; readonly checkedAt: string; readonly receiptId: string; readonly url: string; readonly visible: boolean }[];
  readonly change: "NEW" | "UPDATED" | "REUSED" | "RETAINED" | "UNDETERMINED";
}
export interface ChecklistSnapshot {
  readonly profile: string;
  readonly scopeId: string;
  readonly scopeRevision: string;
  readonly observedAt: string;
  readonly inventory: { readonly complete: boolean; readonly evidenceIds: readonly string[]; readonly unresolvedObjects: number };
  readonly readsComplete: boolean;
  readonly instances: readonly ChecklistInstance[];
  readonly witnesses: readonly ChecklistWitness[];
}
export interface ChecklistItemResult {
  readonly obligationKey: string;
  readonly definitionIds: readonly string[];
  readonly dimension: ChecklistDimension;
  readonly owner: string;
  readonly disposition: RequirementDisposition;
  readonly due: boolean;
  readonly passed: boolean;
  readonly fresh: boolean;
  readonly accepted: boolean;
  readonly visible: boolean;
  readonly witnessId: string | null;
  readonly reasons: readonly string[];
  readonly nextAction: string;
}

export function checklistObligationKey(predicateKey: string, objectId: string, jurisdictionId: string, period: string): string {
  return [predicateKey, objectId, jurisdictionId, period].map(encodeURIComponent).join("|");
}
export function checklistProfileInstanceKey(obligationKey: string, scopeRevision: string): string {
  return [profile.version, scopeRevision, obligationKey].map(encodeURIComponent).join("|");
}

/** Floored display cannot turn a near-complete value into an exact 100. */
export function checklistFraction(passed: number, due: number, unresolved: number) {
  const percent = due > 0 ? Math.floor(passed / due * 1000) / 10 : null;
  return { passed, due, owed: due - passed, unresolved, percent,
    label: due === 0 ? "Not measured" : `${passed} of ${due} known items pass${unresolved ? `; ${unresolved} unresolved — incomplete assessment` : passed < due ? `; ${due-passed} still owed` : ""}` };
}
