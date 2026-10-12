/**
 * Validation and adversarial audit, answered by different roles: the VALIDATOR
 * asks whether the result satisfied the contract; the AUDITOR assumes it did
 * and tries to break it. An audit that started from the original worker's own
 * summary is not independent and does not satisfy `requiresAudit`.
 */

/** The permanent attack modes. New modes are added; none is ever removed. */
export const ATTACK_MODES = [
  "SOURCE_UNIVERSE",
  "IDENTITY",
  "NEGATIVE_SPACE",
  "PROCEDURAL_STAGE",
  "TEMPORAL",
  "GEOGRAPHIC",
  "PROVENANCE",
  "COVERAGE",
  "READER_TRUTH",
  "OPERATIONAL",
  "POLITICAL_NEUTRALITY",
  "REPRODUCIBILITY",
  "CAMPAIGN_FINANCE_COVERAGE",
] as const;
export type AttackMode = (typeof ATTACK_MODES)[number];

/** Where an audit got its evidence. A finding based only on our own summary cannot discharge an audit requirement. */
export const AUDIT_EVIDENCE_BASES = [
  "OUR_SUMMARY",
  "CANONICAL_SUBJECT_IDENTITY",
  "PUBLISHER_SOURCE_UNIVERSE",
  "METHOD_REGISTRY",
  "EVIDENCE_VAULT",
  "INDEPENDENT_FIRST_PARTY_ACQUISITION",
] as const;
export type AuditEvidenceBase = (typeof AUDIT_EVIDENCE_BASES)[number];

/** Bases that constitute genuine independence from the original worker. */
export const INDEPENDENT_BASES: readonly AuditEvidenceBase[] = [
  "PUBLISHER_SOURCE_UNIVERSE",
  "EVIDENCE_VAULT",
  "INDEPENDENT_FIRST_PARTY_ACQUISITION",
];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface AuditFinding {
  readonly id: string;
  readonly workItemId: string;
  readonly mode: AttackMode;
  readonly severity: Severity;
  /** True when the auditor failed to break the claim. */
  readonly survived: boolean;
  readonly startedFrom: readonly AuditEvidenceBase[];
  readonly detail: string;
  readonly at: string;
  readonly resolvedAt: string | null;
}

/** Did this audit look outside our own account of ourselves? */
export function isIndependent(finding: AuditFinding): boolean {
  return finding.startedFrom.some((b) => INDEPENDENT_BASES.includes(b));
}

/** An audit that discharges a `requiresAudit` contract: independent AND survived. */
export function dischargesAudit(finding: AuditFinding): boolean {
  return isIndependent(finding) && finding.survived;
}

export interface ValidationRecord {
  readonly workItemId: string;
  readonly passed: boolean;
  readonly at: string;
  readonly by: string;
  /** Each contract clause the validator actually checked, by name. */
  readonly checked: readonly string[];
  readonly detail: string;
}

/** Two authoritative sources that cannot both be silently accepted. */
export interface Contradiction {
  readonly id: string;
  readonly workItemId: string;
  readonly severity: Severity;
  readonly leftEvidence: string;
  readonly rightEvidence: string;
  readonly detail: string;
  readonly resolvedAt: string | null;
}

export function isBlocking(c: Contradiction): boolean {
  return c.resolvedAt === null && (c.severity === "HIGH" || c.severity === "CRITICAL");
}
