import { canonicalCivicDataHash, civicRecordsFor } from "./changes.ts";
import { manualRecordSourceUrls } from "./manual-source-isolation.ts";
import { authorityForManualReceipt } from "./source-authority.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { publicationBaseHash } from "./navigation-publication-base.ts";
import { registryMemberCitedUrls } from "../registry/cited-urls.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "./types.ts";

const hash = canonicalCivicDataHash;

/** Classes whose successor may inherit unchanged members from its exact GOOD base. */
const INHERITING_CLASSES: ReadonlySet<string> = new Set(["CURATED_READER_RECORD", "REGISTRY_RUNTIME_BINDING"]);

function memberIdentity(recordClass: string, member: { readonly key: string; readonly record: unknown }): string {
  return recordClass === "REGISTRY_RUNTIME_BINDING" ? member.key : (member.record as { readonly id: string }).id;
}
function assertedSources(recordClass: string, key: string, record: unknown): Iterable<string> {
  return recordClass === "REGISTRY_RUNTIME_BINDING" ? registryMemberCitedUrls(key, record) : manualRecordSourceUrls(record);
}

export interface ManualPriorAuthority {
  readonly kind: "VALIDATED_PRIOR_PROJECTION";
  readonly versionId: string;
  readonly readModelSha256: string;
  readonly retainedMembers: readonly { readonly key: string; readonly sha256: string }[];
  readonly additionalProjections?: readonly ManualScopeTransferAuthority[];
}
export type ManualScopeTransferAuthority = Omit<ManualPriorAuthority, "additionalProjections"> & { readonly scope: string };
export type ManualSuccessorCandidate = RoutineCandidate & { readonly manualPriorAuthority?: ManualPriorAuthority };
export const manualPriorAuthorityOf = (candidate: RoutineCandidate): ManualPriorAuthority | undefined =>
  (candidate as ManualSuccessorCandidate).manualPriorAuthority;

export function manualScopeTransferIssue(candidate: RoutineCandidate, source: RoutineCandidate): string | null {
  const target = /^US:(.+)$/.exec(candidate.scope);
  const origin = /^(US(?:-[A-Z]{2}(?:\+US-[A-Z]{2})*)?):(.+)$/.exec(source.scope);
  const targetKind = (candidate.readModel as { kind?: unknown } | null)?.kind;
  const sourceKind = (source.readModel as { kind?: unknown } | null)?.kind;
  if (candidate.recordClass !== "CURATED_READER_RECORD" || source.recordClass !== candidate.recordClass ||
      source.sourceId !== candidate.sourceId || !target || !origin || origin[2] !== target[1] ||
      candidate.scope === source.scope || typeof targetKind !== "string" || targetKind !== sourceKind) {
    return "A scope transfer must preserve the same curated family and source into its national scope.";
  }
  const jurisdictions = new Set(origin[1].split("+"));
  if (source.identities.some(identity => !jurisdictions.has("US") && !jurisdictions.has(identity.jurisdiction))) {
    return "Transferred identities do not belong to their source scope.";
  }
  return null;
}

export function manualPriorAuthorityIssue(candidate: RoutineCandidate, base: CandidateVersionRecord | null,
  additionalBases: readonly CandidateVersionRecord[] = []): string | null {
  const prior = manualPriorAuthorityOf(candidate);
  if (!prior) return null;
  if (prior.kind !== "VALIDATED_PRIOR_PROJECTION" || !INHERITING_CLASSES.has(candidate.recordClass) ||
      candidate.bootstrapImport || !candidate.retrieval.manualSourceReceipt || !Array.isArray(prior.retainedMembers) ||
      (prior.additionalProjections !== undefined && !Array.isArray(prior.additionalProjections))) {
    return "Inherited authority is valid only for unchanged members of a source-reviewed curated Reader or registry successor.";
  }
  const authorities = [{ ...prior, scope: candidate.scope }, ...(prior.additionalProjections ?? [])];
  const members = (value: RoutineCandidate) => new Map(civicRecordsFor(value.recordClass, value.readModel)
    .map(row => [memberIdentity(value.recordClass, row), row.record]));
  const after = members(candidate);
  const retained = new Set<string>();
  const versions = new Set<string>();
  for (const authority of authorities) {
    const source = authority.scope === candidate.scope ? base : additionalBases.find(row => row.candidate.id === authority.versionId);
    const receipt = source ? parseValidationReceipt(source.receipt) : null;
    if (authority.kind !== "VALIDATED_PRIOR_PROJECTION" || !Array.isArray(authority.retainedMembers) ||
        versions.has(authority.versionId) || !source || source.state !== "PROMOTED" || !source.acquisitionSucceeded ||
        receipt?.decision !== "GOOD" || receipt.checks.some(check => check.verdict !== "PASS") ||
        source.promotedVersion !== authority.versionId || source.lastKnownGoodVersion !== authority.versionId ||
        source.candidate.id !== authority.versionId || source.candidate.sourceId !== candidate.sourceId ||
        source.candidate.recordClass !== candidate.recordClass || source.candidate.scope !== authority.scope ||
        publicationBaseHash(source) !== authority.readModelSha256) {
      return "The inherited authority does not identify the exact GOOD base and its payload.";
    }
    versions.add(authority.versionId);
    if (authority.scope !== candidate.scope) {
      const issue = manualScopeTransferIssue(candidate, source.candidate);
      if (issue) return issue;
    }
    if (source.candidate.bootstrapImport) {
      const importIssue = trustedLkgImportEvidenceIssue(source.candidate, null);
      if (importIssue || receipt.checks.find(check => check.check === "SOURCE_AUTHENTICITY")?.code !== "TRUSTED_LKG_IMPORT_PROVENANCE_VALID") {
        return `The inherited imported base lacks intact transfer evidence: ${importIssue ?? "incorrect source check"}.`;
      }
    } else if (!authorityForManualReceipt(source.candidate.sourceId, source.candidate.recordClass,
      source.candidate.retrieval.manualSourceReceipt, source.candidate.retrieval.finalUrl).ok) {
      return "The ordinary manual base has no valid source authority; it cannot become inherited authority.";
    }
    const before = members(source.candidate);
    for (const member of authority.retainedMembers) {
      if (!member || typeof member.key !== "string" || !member.key || retained.has(member.key) ||
          !before.has(member.key) || !after.has(member.key) ||
          hash(before.get(member.key)) !== member.sha256 || hash(after.get(member.key)) !== member.sha256) {
        return "An inherited member was changed, duplicated, invented, or omitted; prior authority cannot authorize it.";
      }
      if (authority.scope !== candidate.scope) {
        const identities = (value: RoutineCandidate) => value.identities.filter(identity => identity.identifiers.record_id === member.key);
        const original = identities(source.candidate), copied = identities(candidate);
        if (original.length !== 1 || copied.length !== 1 || hash(original[0]) !== hash(copied[0])) {
          return "A scope transfer changed or omitted its original exact member identity.";
        }
      }
      retained.add(member.key);
    }
  }
  if (retained.size === 0) return "Inherited authority names no unchanged facts.";
  const sourceUrls = new Set(candidate.retrieval.manualSourceReceipt.sources
    .filter(source => source.reviewOutcome !== "BLOCKED").flatMap(source => [source.requestedUrl, source.finalUrl]));
  for (const [key, record] of after) {
    if (retained.has(key)) continue;
    for (const url of assertedSources(candidate.recordClass, key, record)) {
      if (!sourceUrls.has(url)) return `Changed or new member ${key} lacks an exact current source review for ${url}.`;
    }
  }
  return null;
}
