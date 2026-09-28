import type { AssignmentSources } from "../assignment-view.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";

/** Narrow factual progress for OFF/GOV. A field row is not a whole checklist
 * witness: effective term, expected universe, freshness and public surface
 * must be proved separately before the original predicate can pass. */
export interface ChecklistOfficialFieldEvidence {
  readonly workItemId: string;
  /** Source-spanned display text only; it does not assert current office or body status. */
  readonly recordLabel?: string;
  readonly subjectId: string;
  readonly recordClass: "OFFICIAL_ROSTER" | "OFFICIAL_BOARD_DIRECTORY";
  readonly recordId: string;
  readonly observedAt: string;
  readonly effectivePeriod: "UNRESOLVED";
  readonly sourceUrl: string;
  readonly artifactId: string;
  readonly contentHash: string;
  readonly acquisitionAttemptId: string;
  readonly parserResultId: string;
  readonly validatorResultId: string | null;
  readonly auditorResultId: string | null;
  readonly fields: readonly { readonly name: string; readonly capturedValue?: string | number | boolean; readonly spanIds: readonly string[];
    readonly capturedValueState?: "PRESENT" | "WITHHELD_NOT_PUBLIC_OFFICE" | "AVAILABLE_IN_CAPTURE";
    readonly recordSurvivedChecks: boolean; readonly independentlyMatched: boolean;
    readonly officialContactEligible: boolean; readonly readerFieldVisible: "UNMEASURED" }[];
  readonly reader: {
    readonly state: "EXACT_READER_BINDING_ACCEPTED" | "UNBOUND";
    readonly objectId: string | null;
    readonly candidateId: string | null;
    readonly versionId: string | null;
    readonly publishedAt: string | null;
    readonly publicSurface: "UNMEASURED";
  };
  readonly relatedPredicates: readonly { readonly id: string; readonly residual: string }[];
}

const related = {
  OFFICIAL_ROSTER: [
    { id: "OFF-04", residual: "An observed name and office do not establish current occupancy, vacancy, or term." },
    { id: "OFF-05", residual: "A source row and reader binding do not resolve every same-name identity across sources." },
    { id: "OFF-06", residual: "Term start and end require their own official dates; capture time is not a term." },
    { id: "OFF-08", residual: "The official page relationship can be traced, but effective period, freshness, and live public visibility remain unmeasured." },
    { id: "OFF-09", residual: "Only source-spanned public-office channels count; personal channels and missing contact fields remain owed." },
  ],
  OFFICIAL_BOARD_DIRECTORY: [
    { id: "GOV-02", residual: "A directory row alone does not prove parent binding and a publicly visible current body." },
    { id: "GOV-03", residual: "One captured directory row does not prove the complete directory was reviewed." },
    { id: "GOV-05", residual: "Body classification requires verified source field and accepted reader identity." },
    { id: "GOV-08", residual: "Official URL and public contact need separate source spans and public reader proof." },
    { id: "GOV-11", residual: "A parsed row count is not a competent expected-body denominator." },
  ],
} as const;

const present = (value: unknown): boolean => typeof value === "string" ? value.trim().length > 0 :
  typeof value === "number" || typeof value === "boolean";
const time = (value: string | null | undefined): number => value ? Date.parse(value) : NaN;

/** Exact receipt, source Attempt, field span, independent per-row checks and
 * publication binding are joined without granting whole-clause checklist
 * credit or treating a typed projection readback as live public visibility. */
export function checklistOfficialFieldEvidence(input: {
  readonly scope: ExpansionScopeDecision;
  readonly sources: AssignmentSources;
  readonly observedAt: string;
  readonly knownRecordKeys: ReadonlySet<string>;
}): readonly ChecklistOfficialFieldEvidence[] {
  const { scope, sources, observedAt } = input;
  const members = new Set(sources.obligations.filter(obligation =>
    obligation.assignments?.some(mark => mark.assignmentKey === scope.key && mark.ref === scope.receiptId))
    .map(obligation => obligation.subjectId));
  const work = new Map(sources.workItems.map(row => [row.id, row]));
  const attempts = new Map(sources.attempts.map(row => [row.id, row]));
  const artifacts = new Map(sources.artifacts.map(row => [row.artifactId, row]));
  const rows: ChecklistOfficialFieldEvidence[] = [];
  for (const parser of sources.workerResults) {
    if (parser.result.role !== "PARSER" || parser.result.verdict !== "EXTRACTED" ||
        !["OFFICIAL_ROSTER", "OFFICIAL_BOARD_DIRECTORY"].includes(parser.result.recordClass)) continue;
    const parsed = parser.result;
    const owner = work.get(parser.workItemId);
    if (!owner || owner.project !== "freshness" || owner.subject !== parsed.subjectId ||
        !owner.autonomousPlan?.ownerInstructions?.includes(scope.receiptId) || !members.has(parsed.subjectId)) continue;
    const marks = sources.obligations.filter(row => row.subjectId === parsed.subjectId)
      .flatMap(row => row.assignments?.filter(mark => mark.assignmentKey === scope.key) ?? []);
    const joined = Math.min(...marks.filter(mark => mark.ref === scope.receiptId).map(mark => time(mark.at)).filter(Number.isFinite));
    const next = Math.min(...marks.filter(mark => mark.ref !== scope.receiptId && time(mark.at) >= joined)
      .map(mark => time(mark.at)).filter(Number.isFinite));
    if (!Number.isFinite(joined) || time(parser.startedAt) < Math.max(joined, time(scope.budgetStartedAt ?? scope.decidedAt)) ||
        time(parser.endedAt) > time(observedAt) || time(parser.startedAt) >= next) continue;
    const acquired = attempts.get(parsed.acquiredByAttemptId), artifact = artifacts.get(parsed.artifactId);
    if (!acquired || acquired.outcome !== "COMPLETED" || !acquired.artifactIds.includes(parsed.artifactId) ||
        acquired.workItemId !== owner.id || !artifact || artifact.workItemId !== owner.id ||
        artifact.attemptId !== acquired.id || artifact.partial || artifact.contentHash !== parsed.contentHash ||
        artifact.tier !== "RAW" || !Number.isFinite(time(artifact.recordedAt)) ||
        time(artifact.recordedAt) > time(observedAt) ||
        !parsed.contractMetadata?.sourceScope.canonicalUrls.includes(artifact.canonicalUrl)) continue;
    const validators = sources.workerResults.filter(row => row.workItemId === owner.id &&
      row.result.role === "VALIDATOR" && row.inputResultIds.includes(parser.id) &&
      row.result.producerAttemptId === parser.attemptId);
    const auditors = sources.workerResults.filter(row => row.workItemId === owner.id &&
      row.result.role === "ADVERSARIAL_AUDITOR" && row.inputResultIds.includes(parser.id));
    for (const record of parsed.records) {
      if (!input.knownRecordKeys.has(JSON.stringify([parsed.subjectId, parsed.recordClass, record.id])) ||
          record.subjectId !== parsed.subjectId) continue;
      const validator = validators.find(row => row.result.role === "VALIDATOR" &&
        row.result.validatedRecordIds?.includes(record.id) && time(row.endedAt) <= time(observedAt));
      const auditor = auditors.find(row => row.result.role === "ADVERSARIAL_AUDITOR" &&
        row.inputResultIds.includes(validator?.id ?? "") && row.result.survivingRecordIds?.includes(record.id) &&
        time(row.endedAt) <= time(observedAt));
      const verified = Boolean(validator && auditor);
      const fields = Object.entries(record.fields).flatMap(([name, value]) => {
        if (!present(value)) return [];
        const spans = parsed.spans.filter(span => span.recordId === record.id && span.field === name &&
          span.artifactId === parsed.artifactId && span.contentHash === parsed.contentHash &&
          record.evidenceSpanIds.includes(span.id));
        const independent = validator?.result.role === "VALIDATOR" && validator.result.externalVerifications?.some(check =>
          check.verdict === "PASS" && check.verifiedRecordIds?.includes(record.id) &&
          ["RECORD_VALUES", "RECORD_VALUES_SUBSET"].includes(check.comparison.kind) &&
          "fields" in check.comparison && check.comparison.fields.includes(name)) === true;
        const privateContact = ["phone", "email"].includes(name) && record.fields.contactKind !== "PUBLIC_OFFICE";
        const longValue = typeof value === "string" && value.length > 4096;
        return spans.length ? [{ name, ...(!privateContact && !longValue ? { capturedValue: value as string | number | boolean } : {}),
          capturedValueState: privateContact ? "WITHHELD_NOT_PUBLIC_OFFICE" as const : longValue ? "AVAILABLE_IN_CAPTURE" as const : "PRESENT" as const,
          spanIds: spans.map(span => span.id), recordSurvivedChecks: verified,
          independentlyMatched: verified && independent,
          officialContactEligible: ["phone", "email"].includes(name) && record.fields.contactKind === "PUBLIC_OFFICE",
          readerFieldVisible: "UNMEASURED" as const }] : [];
      });
      if (!fields.length) continue;
      const publication = owner.publicationOutcome;
      const accepted = publication && publication.status !== "HELD" &&
        publication.workerResultId === auditor?.id && publication.candidateId && publication.versionId &&
        time(publication.at) <= time(observedAt);
      const member = parsed.recordClass === "OFFICIAL_ROSTER" && accepted
        ? publication.acceptedMembers?.find(binding => binding.recordId === record.id) : null;
      const body = parsed.recordClass === "OFFICIAL_BOARD_DIRECTORY" && accepted
        ? publication.acceptedBodies?.find(binding => binding.recordId === record.id &&
          publication.bodyIds?.includes(binding.bodyId) && publication.recordChanges?.some(change =>
            change.recordId === binding.recordId && change.readerId === binding.bodyId)) : null;
      const readerObjectId = member?.memberId ?? body?.bodyId ?? null;
      const labelField = parsed.recordClass === "OFFICIAL_BOARD_DIRECTORY" ? "bodyName" : "name";
      const recordLabel = fields.some(field => field.name === labelField) &&
        typeof record.fields[labelField] === "string" && record.fields[labelField].trim()
        ? record.fields[labelField].trim().slice(0, 160) : record.id;
      rows.push({ workItemId: owner.id, recordLabel, subjectId: parsed.subjectId,
        recordClass: parsed.recordClass as ChecklistOfficialFieldEvidence["recordClass"],
        recordId: record.id, observedAt: artifact.recordedAt, effectivePeriod: "UNRESOLVED",
        sourceUrl: artifact.canonicalUrl, artifactId: artifact.artifactId,
        contentHash: artifact.contentHash, acquisitionAttemptId: acquired.id,
        parserResultId: parser.id, validatorResultId: validator?.id ?? null, auditorResultId: auditor?.id ?? null,
        fields, reader: readerObjectId && publication ? { state: "EXACT_READER_BINDING_ACCEPTED", objectId: readerObjectId,
          candidateId: publication.candidateId, versionId: publication.versionId, publishedAt: publication.at,
          publicSurface: "UNMEASURED" } : { state: "UNBOUND", objectId: null,
          candidateId: null, versionId: null, publishedAt: null, publicSurface: "UNMEASURED" },
        relatedPredicates: related[parsed.recordClass as keyof typeof related] });
    }
  }
  rows.sort((a,b) => a.subjectId.localeCompare(b.subjectId) ||
    a.recordClass.localeCompare(b.recordClass) || a.recordId.localeCompare(b.recordId) ||
    Number(b.reader.state === "EXACT_READER_BINDING_ACCEPTED") - Number(a.reader.state === "EXACT_READER_BINDING_ACCEPTED") ||
    b.observedAt.localeCompare(a.observedAt));
  // Retries remain in the canonical worker log. The census carries one
  // best-held field chain per exact record so repeated Scouts do not inflate it.
  const selected = new Map<string, ChecklistOfficialFieldEvidence>();
  for (const row of rows) {
    const key = JSON.stringify([row.subjectId, row.recordClass, row.recordId]);
    if (!selected.has(key)) selected.set(key, row);
  }
  return [...selected.values()];
}
