import { createHash } from "node:crypto";
import { canonicalCivicDataJson, civicRecordsFor } from "./changes.ts";
import { directPositiveSourceUrls } from "./manual-source-isolation.ts";
import { authorityForManualReceipt } from "./source-authority.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { registryMemberCitedUrls, inheritedRosterSourceFacts } from "../registry/cited-urls.ts";
import type { CandidateVersionRecord, RoutineCandidate } from "./types.ts";

const hash = (value: unknown) => createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");

/** Classes whose successor may inherit unchanged members from its exact GOOD base. */
const INHERITING_CLASSES: ReadonlySet<string> = new Set(["CURATED_READER_RECORD", "REGISTRY_RUNTIME_BINDING"]);

/**
 * A member's identity and the sources it asserts. A curated record is its own
 * id and cites every HTTPS value it holds. A registry member is keyed as the
 * change accounting keys it and cites its named source fields only
 * (lib/registry/cited-urls.ts, the rule its promotion also applies).
 */
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
  readonly retainedRosterSources?: readonly { readonly key: string; readonly url: string; readonly sha256: string }[];
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
      !Array.isArray(prior.retainedMembers) || (prior.retainedRosterSources !== undefined && !Array.isArray(prior.retainedRosterSources)) ||
      (prior.retainedMembers.length === 0 && !prior.retainedRosterSources?.length)) {
    return "Inherited authority is valid only for unchanged members of a source-reviewed curated Reader or registry successor.";
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
  // A curated member is the payload's exact id; civicRecordsFor adds a
  // record-class prefix for change accounting, which is a different key. A
  // registry member has no one id field, so its change-accounting key is it.
  const members = (value: RoutineCandidate) => new Map(civicRecordsFor(value.recordClass, value.readModel)
    .map((row) => [memberIdentity(value.recordClass, row), row.record]));
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
  const retainedSources = new Set<string>();
  for (const source of prior.retainedRosterSources ?? []) {
    if (!source || typeof source.key !== "string" || typeof source.url !== "string") return "Invalid inherited roster source.";
    const identity = `${source.key}\n${source.url}`;
    const facts = inheritedRosterSourceFacts(before.get(source.key), after.get(source.key));
    if (candidate.recordClass !== "REGISTRY_RUNTIME_BINDING" || !source.key.startsWith("body-roster:") ||
        retainedSources.has(identity) || !facts.has(source.url) || hash(facts.get(source.url)) !== source.sha256) {
      return "An inherited roster source changed its exact person identity or facts, or lacks the named prior evidence.";
    }
    retainedSources.add(identity);
  }
  for (const [key, record] of after) {
    if (retained.has(key)) continue;
    for (const url of assertedSources(candidate.recordClass, key, record)) {
      if (!sourceUrls.has(url) && !retainedSources.has(`${key}\n${url}`)) return `Changed or new member ${key} lacks an exact current source review for ${url}.`;
    }
  }
  return null;
}
