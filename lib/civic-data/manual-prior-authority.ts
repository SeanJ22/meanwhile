import { createHash } from "node:crypto";
import { canonicalCivicDataJson, civicRecordsFor } from "./changes.ts";
import { directPositiveSourceUrls } from "./manual-source-isolation.ts";
import { authorityForManualReceipt } from "./source-authority.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import { parseValidationReceipt } from "./receipt.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "./types.ts";

const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

export interface ManualPriorAuthority {
  readonly kind: "VALIDATED_PRIOR_PROJECTION";
  readonly versionId: string;
  readonly readModelSha256: string;
  readonly retainedMembers: readonly { readonly key: string; readonly sha256: string }[];
}
export type ManualSuccessorCandidate = RoutineCandidate & { readonly manualPriorAuthority?: ManualPriorAuthority };
export const manualPriorAuthorityOf = (candidate: RoutineCandidate): ManualPriorAuthority | undefined =>
  (candidate as ManualSuccessorCandidate).manualPriorAuthority;

/** Current source reviews authorize new facts; the exact GOOD base authorizes unchanged inherited facts. */
export function manualPriorAuthorityIssue(candidate: RoutineCandidate, base: CandidateVersionRecord | null): string | null {
  const prior = manualPriorAuthorityOf(candidate);
  if (!prior) return null;
  if (prior.kind !== "VALIDATED_PRIOR_PROJECTION" || candidate.recordClass !== "CURATED_READER_RECORD" ||
      candidate.bootstrapImport || !candidate.retrieval.manualSourceReceipt ||
      !Array.isArray(prior.retainedMembers) || prior.retainedMembers.length === 0) {
    return "Inherited authority is valid only for unchanged members of a source-reviewed curated Reader successor.";
  }
  const receipt = base ? parseValidationReceipt(base.receipt) : null;
  if (!base || base.state !== "PROMOTED" || !base.acquisitionSucceeded || receipt?.decision !== "GOOD" ||
      receipt.checks.some((check) => check.verdict !== "PASS") ||
      base.promotedVersion !== prior.versionId || base.lastKnownGoodVersion !== prior.versionId ||
      base.candidate.id !== prior.versionId || base.candidate.sourceId !== candidate.sourceId ||
      base.candidate.recordClass !== candidate.recordClass || base.candidate.scope !== candidate.scope ||
      hash(base.candidate.readModel) !== prior.readModelSha256) {
    return "The inherited authority does not identify the exact GOOD current base and its payload.";
  }
  if (base.candidate.bootstrapImport) {
    const importIssue = trustedLkgImportEvidenceIssue(base.candidate, null);
    if (importIssue || receipt.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code !== "TRUSTED_LKG_IMPORT_PROVENANCE_VALID") {
      return `The inherited imported base lacks intact, independently checkable transfer evidence: ${importIssue ?? "incorrect source check"}.`;
    }
  } else if (!authorityForManualReceipt(base.candidate.sourceId, base.candidate.recordClass,
    base.candidate.retrieval.manualSourceReceipt, base.candidate.retrieval.finalUrl).ok) {
    return "The ordinary manual base has no valid source authority; it cannot become inherited authority.";
  }
  // The source-isolation member id is the payload's exact id. civicRecordsFor
  // adds a record-class prefix for change accounting; that is a different key.
  const members = (value: RoutineCandidate) => new Map(civicRecordsFor(value.recordClass, value.readModel)
    .map((row) => [(row.record as { readonly id: string }).id, row.record]));
  const before = members(base.candidate);
  const after = members(candidate);
  const retained = new Set<string>();
  for (const member of prior.retainedMembers) {
    if (!member || typeof member.key !== "string" || !member.key || retained.has(member.key) ||
        !before.has(member.key) || !after.has(member.key) ||
        hash(before.get(member.key)) !== member.sha256 || hash(after.get(member.key)) !== member.sha256) {
      return "An inherited member was changed, duplicated, invented, or omitted; prior authority cannot authorize it.";
    }
    retained.add(member.key);
  }
  const sourceUrls = new Set(candidate.retrieval.manualSourceReceipt.sources
    .filter((source) => source.reviewOutcome !== "BLOCKED").flatMap((source) => [source.requestedUrl, source.finalUrl]));
  for (const [key, record] of after) {
    if (retained.has(key)) continue;
    for (const url of directPositiveSourceUrls(record)) {
      if (!sourceUrls.has(url)) return `Changed or new member ${key} lacks an exact current source review for ${url}.`;
    }
  }
  return null;
}
