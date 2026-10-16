import { statePublicationPriorOf } from "./state-publication-prior.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { civicRecordsFor } from "./changes.ts";
import { directPositiveSourceUrls } from "./manual-source-isolation.ts";
import { authorityForManualReceipt } from "./source-authority.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { registryMemberCitedUrls } from "../registry/cited-urls.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "./types.ts";

const hash = canonicalCivicDataHash;

/** Classes whose successor may inherit unchanged members from its exact GOOD base. */
const INHERITING_CLASSES: ReadonlySet<string> = new Set(["CURATED_READER_RECORD", "REGISTRY_RUNTIME_BINDING"]);

function memberIdentity(recordClass: string, member: { readonly key: string; readonly record: unknown }): string {
  return recordClass === "REGISTRY_RUNTIME_BINDING" ? member.key : (member.record as { readonly id: string }).id;
}
function assertedSources(recordClass: string, key: string, record: unknown): Iterable<string> {
  return recordClass === "REGISTRY_RUNTIME_BINDING" ? registryMemberCitedUrls(key, record) : directPositiveSourceUrls(record);
}

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
  if (prior.kind !== "VALIDATED_PRIOR_PROJECTION" || !INHERITING_CLASSES.has(candidate.recordClass) ||
      candidate.bootstrapImport || !candidate.retrieval.manualSourceReceipt ||
      !Array.isArray(prior.retainedMembers) || prior.retainedMembers.length === 0) {
    return "Inherited authority is valid only for unchanged members of a source-reviewed curated Reader or registry successor.";
  }
  const receipt = base ? parseValidationReceipt(base.receipt) : null;
  const indexedPrior = base ? statePublicationPriorOf(base.candidate) : undefined;
  if (!base || base.state !== "PROMOTED" || !base.acquisitionSucceeded || receipt?.decision !== "GOOD" ||
      receipt.checks.some((check) => check.verdict !== "PASS") ||
      base.promotedVersion !== prior.versionId || base.lastKnownGoodVersion !== prior.versionId ||
      base.candidate.id !== prior.versionId || base.candidate.sourceId !== candidate.sourceId ||
      base.candidate.recordClass !== candidate.recordClass || base.candidate.scope !== candidate.scope ||
      (indexedPrior?.payloadHash ?? hash(base.candidate.readModel)) !== prior.readModelSha256) {
    return "The inherited authority does not identify the exact GOOD current base and its payload.";
  }
  if (indexedPrior) {
    if (indexedPrior.versionId !== prior.versionId) return "The inherited authority names a different indexed version.";
  } else if (base.candidate.bootstrapImport) {
    const importIssue = trustedLkgImportEvidenceIssue(base.candidate, null);
    if (importIssue || receipt.checks.find((check) => check.check === "SOURCE_AUTHENTICITY")?.code !== "TRUSTED_LKG_IMPORT_PROVENANCE_VALID") {
      return `The inherited imported base lacks intact, independently checkable transfer evidence: ${importIssue ?? "incorrect source check"}.`;
    }
  } else if (!authorityForManualReceipt(base.candidate.sourceId, base.candidate.recordClass,
    base.candidate.retrieval.manualSourceReceipt, base.candidate.retrieval.finalUrl).ok) {
    return "The ordinary manual base has no valid source authority; it cannot become inherited authority.";
  }
  const members = (value: RoutineCandidate) => new Map(civicRecordsFor(value.recordClass, value.readModel)
    .map((row) => [memberIdentity(value.recordClass, row), row.record]));
  const before = indexedPrior ? new Map([...indexedPrior.members].map(([key, member]) =>
    [candidate.recordClass === "REGISTRY_RUNTIME_BINDING" ? key : key.replace(/^curated-reader:/, ""), member.sha256])) : members(base.candidate);
  const after = members(candidate);
  const retained = new Set<string>();
  for (const member of prior.retainedMembers) {
    if (!member || typeof member.key !== "string" || !member.key || retained.has(member.key) ||
        !before.has(member.key) || !after.has(member.key) ||
        (indexedPrior ? before.get(member.key) : hash(before.get(member.key))) !== member.sha256 || hash(after.get(member.key)) !== member.sha256) {
      return "An inherited member was changed, duplicated, invented, or omitted; prior authority cannot authorize it.";
    }
    retained.add(member.key);
  }
  const sourceUrls = new Set(candidate.retrieval.manualSourceReceipt.sources
    .filter((source) => source.reviewOutcome !== "BLOCKED").flatMap((source) => [source.requestedUrl, source.finalUrl]));
  for (const [key, record] of after) {
    if (retained.has(key)) continue;
    for (const url of assertedSources(candidate.recordClass, key, record)) {
      if (!sourceUrls.has(url)) return `Changed or new member ${key} lacks an exact current source review for ${url}.`;
    }
  }
  return null;
}
