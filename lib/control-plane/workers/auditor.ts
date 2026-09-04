import type { AttackMode } from "../audit.ts";
import type {
  AuditAttackResult, AuditorResult, AuditorWorkerInput, FieldValue,
  CivicExtractionContract, IndependentAuditContext, WorkerEvidence, WorkerFinding,
} from "./types.ts";

/** Portable procedure executed by the disposable worker broker. No ambient I/O. */
export const AUDITOR_IMPLEMENTATION = "civic-events-independent-evidence-auditor";
export const AUDITOR_VERSION = "1";
// Kept literal so the isolated module needs no runtime imports. A permanent
// test compares this selection with the canonical, append-only attack registry.
export const AUDITOR_ATTACK_MODES = [
  "SOURCE_UNIVERSE", "IDENTITY", "NEGATIVE_SPACE", "PROCEDURAL_STAGE",
  "TEMPORAL", "GEOGRAPHIC", "PROVENANCE", "COVERAGE", "READER_TRUTH",
  "OPERATIONAL", "POLITICAL_NEUTRALITY", "REPRODUCIBILITY", "CAMPAIGN_FINANCE_COVERAGE",
] as const satisfies readonly AttackMode[];

type SourceRow = Readonly<Record<string, unknown>>;
interface InventoryEntry {
  readonly evidence: WorkerEvidence;
  readonly rows: readonly SourceRow[];
  readonly root: unknown;
  readonly declared: number | null;
  readonly error: string | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function scalar(value: unknown): value is FieldValue {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
function host(url: string): string | null {
  // Context comes from the broker's public URL guard. Refuse unfamiliar forms
  // here as well; never infer first-party status from a substring in the URL.
  return /^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#]|$)/i.exec(url)?.[1].toLowerCase() ?? null;
}
function publisherHost(surface: string): string | null {
  return host(surface) ?? (/^[a-z0-9.-]+$/i.test(surface) ? surface.toLowerCase() : null);
}
function sourceId(row: SourceRow, contract: CivicExtractionContract): string | null {
  const civicClerk = contract.recordClass === "CIVICCLERK_EVENTS";
  const id = row[civicClerk ? "id" : "EventId"];
  return Number.isSafeInteger(id) && Number(id) > 0 ? `${civicClerk ? "civicclerk" : "legistar"}:${contract.publisherSlug}:${id}` : null;
}
function rowInScope(row: SourceRow, contract: CivicExtractionContract): boolean {
  // CivicClerk categories are NOT body identities. A municipal feed may contain
  // council, planning, and possible-quorum notices; preserve every category.
  return contract.recordClass === "CIVICCLERK_EVENTS" || (row.EventBodyId === contract.sourceBodyId && row.EventBodyName === contract.sourceBodyName);
}
function finding(code: string, detail: string, severity: WorkerFinding["severity"] = "BLOCKING", recordId?: string, field?: string): WorkerFinding {
  return { code, detail, severity, ...(recordId ? { recordId } : {}), ...(field ? { field } : {}) };
}

/** Deliberately receives no candidate: expectations are constructed first. */
function inventory(context: IndependentAuditContext): readonly InventoryEntry[] {
  return context.evidence.map((evidence) => {
    let root: unknown;
    try { root = JSON.parse(evidence.text); }
    catch { return { evidence, root: null, rows: [], declared: null, error: "evidence is not parseable JSON" }; }
    const values = Array.isArray(root) ? root : object(root) && Array.isArray(root.value) ? root.value : null;
    const count = object(root) ? root["@odata.count"] ?? root["odata.count"] : undefined;
    const declared = typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count
      : typeof count === "string" && /^(0|[1-9][0-9]*)$/.test(count) && Number.isSafeInteger(Number(count)) ? Number(count) : null;
    if (values === null || values.some((row) => !object(row))) {
      return { evidence, root, rows: [], declared, error: "evidence is not an Events array or OData value array" };
    }
    const rows = values as SourceRow[];
    const error = count !== undefined && declared === null ? "the publisher count is malformed"
      : rows.some((row) => sourceId(row, context.contract) === null) ? "a publisher row has no valid event ID" : null;
    return { evidence, root, rows, declared, error };
  });
}

function pointer(root: unknown, path: string): unknown {
  if (!path.startsWith("/")) return undefined;
  let value = root;
  for (const token of path.slice(1).split("/")) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return undefined;
      value = value[Number(key)];
    } else if (object(value) && Object.prototype.hasOwnProperty.call(value, key)) value = value[key];
    else return undefined;
  }
  return value;
}

export function auditExtraction(input: AuditorWorkerInput): AuditorResult {
  const { context } = input;
  const independent = inventory(context);
  // No producer or validator output participates in the inventory above.
  const { candidate } = input;
  const extraction = candidate.extraction;
  const contract = context.contract;
  const civicClerk = contract.recordClass === "CIVICCLERK_EVENTS";
  const captured = independent.find((entry) => entry.evidence.artifactId === extraction.artifactId);
  const globalClaim = context.scope === "SOURCE_UNIVERSE" || candidate.claimsUniverseComplete || candidate.claimsAbsence;
  const applicableRoutes = context.routes.filter((route) => route.applicable && route.status !== "NOT_APPLICABLE");
  const sources = globalClaim ? independent : captured ? [captured] : [];
  const evidenceComplete = sources.length > 0 && sources.every((entry) => entry.error === null);
  const expected = new Map<string, SourceRow>();
  for (const entry of sources) for (const row of entry.rows) {
    const id = sourceId(row, contract);
    if (id && rowInScope(row, contract) && !expected.has(id)) expected.set(id, row);
  }
  const records = new Map(extraction.records.map((record) => [record.id, record]));
  const byMode = new Map<AttackMode, AuditAttackResult>();
  const add = (mode: AttackMode, applicable: boolean, reason: string, findings: WorkerFinding[] = [], complete = true) => {
    byMode.set(mode, {
      mode, applicable, executed: applicable && complete, reason,
      verdict: !applicable ? "NOT_APPLICABLE" : findings.some((f) => f.severity === "BLOCKING") ? "BROKE" : !complete ? "INCONCLUSIVE" : "SURVIVED",
      findings,
    });
  };

  const routeFindings: WorkerFinding[] = [];
  for (const route of applicableRoutes) {
    const covered = candidate.coveredRouteIds.includes(route.routeId);
    const evidenceHeld = route.artifactIds.length > 0 && route.artifactIds.every((id) => independent.some((entry) => entry.evidence.artifactId === id) || context.surfaceEvidence?.some(e => e.artifactId === id));
    if (globalClaim && (!covered || route.status !== "HELD" || !evidenceHeld)) {
      routeFindings.push(finding("AUDIT_OFFICIAL_ROUTE_OMITTED", `Applicable official route ${route.routeId} is ${route.status}; coverage claimed=${covered}, cited evidence held=${evidenceHeld}.`));
    } else if (route.status !== "HELD" || !covered) {
      routeFindings.push(finding("AUDIT_ROUTE_REMAINS_OWED", `Route ${route.routeId} remains ${route.status}; this audit is limited to the captured artifact. ${route.reason}`, "INFO"));
    }
  }
  const contextReady = context.publisherSurfaces.length > 0 && applicableRoutes.length > 0 && independent.length > 0 && Number.isSafeInteger(context.methodVersion) && context.methodVersion > 0;
  if (!contextReady) routeFindings.push(finding("AUDIT_SOURCE_UNIVERSE_UNESTABLISHED", "The independent publisher, applicable method-route floor, version, or vault inventory is missing.", "WARNING"));
  add("SOURCE_UNIVERSE", true, globalClaim ? "Compare the claimed complete universe with independently inherited official routes." : "Audit captured extraction; retain every outstanding official route without declaring the universe complete.", routeFindings, contextReady);

  const identityFindings: WorkerFinding[] = [];
  if (context.subjectId !== contract.subjectId || extraction.subjectId !== context.subjectId) identityFindings.push(finding("AUDIT_IDENTITY_MISMATCH", "Candidate, canonical context, and governing contract name different subjects."));
  if (extraction.recordClass !== contract.recordClass || (civicClerk && (contract.sourceBodyId !== null || contract.sourceBodyName !== null))) identityFindings.push(finding("AUDIT_IDENTITY_MISMATCH", "The extraction class or municipal feed binding improperly assigns source categories to one governing body."));
  for (const record of extraction.records) {
    const categoryBound = civicClerk ? Number.isSafeInteger(record.fields.categoryId) && typeof record.fields.eventCategoryName === "string" && typeof record.fields.eventName === "string" : rowInScope(record.fields, contract);
    if (record.subjectId !== context.subjectId || !categoryBound || record.id !== sourceId(record.fields, contract)) {
      identityFindings.push(finding("AUDIT_IDENTITY_MISMATCH", "The plausible meeting identity does not bind to the canonical body and publisher event ID.", "BLOCKING", record.id));
    }
  }
  add("IDENTITY", true, "Bind event identity and government body to the independent canonical subject.", identityFindings);

  const absence = candidate.claimsAbsence || extraction.actualRowCount === 0;
  const absenceFindings: WorkerFinding[] = [];
  if (absence) {
    const open = applicableRoutes.some((route) => route.status !== "HELD" || !candidate.coveredRouteIds.includes(route.routeId));
    if (expected.size > 0 || open || !candidate.claimsAbsence) absenceFindings.push(finding("AUDIT_UNSUPPORTED_ABSENCE", `An absence/empty-result claim has ${expected.size} independently observed records and outstanding applicable routes=${open}.`));
    else absenceFindings.push(finding("AUDIT_ABSENCE_NOT_ESTABLISHED", "Empty route results alone cannot prove publisher absence; affirmative source evidence about the record is required.", "WARNING"));
  }
  add("NEGATIVE_SPACE", absence, "Only absence or zero-row claims invoke the publisher-absence burden.", absenceFindings, !absence || absenceFindings.some((f) => f.severity === "BLOCKING"));

  const identityFields = civicClerk ? ["categoryId", "eventCategoryId", "eventCategoryName", "eventName"] : ["EventBodyId", "EventBodyName"];
  const temporalFields = civicClerk ? ["eventDate", "startDateTime"] : ["EventDate", "EventTime"];
  const stageFields = civicClerk ? ["isPublished", "eventName", "eventCategoryName", "hasAgenda", "isArchived", "isDeleted"] : ["EventAgendaStatusName", "EventMinutesStatusName"];
  const comparisonFindings = (fields: readonly string[], code: string): WorkerFinding[] => {
    const result: WorkerFinding[] = [];
    for (const record of extraction.records) {
      const source = expected.get(record.id);
      if (!source) continue;
      for (const field of fields) if (Object.prototype.hasOwnProperty.call(record.fields, field) && record.fields[field] !== source[field]) result.push(finding(code, `The claimed ${field} differs from independent publisher evidence.`, "BLOCKING", record.id, field));
    }
    return result;
  };
  const stagesApply = [...expected.values()].some((row) => stageFields.some((field) => Object.prototype.hasOwnProperty.call(row, field))) || extraction.records.some((row) => stageFields.some((field) => Object.prototype.hasOwnProperty.call(row.fields, field)));
  add("PROCEDURAL_STAGE", stagesApply, "Compare publisher stage/category fields without converting a possible quorum notice or agenda flag into a completed council meeting.", comparisonFindings(stageFields, "AUDIT_PROCEDURAL_STAGE_MISMATCH"));
  const temporalFindings = comparisonFindings(temporalFields, "AUDIT_TEMPORAL_MISMATCH");
  for (const record of extraction.records) {
    for (const field of civicClerk ? ["eventDate", "startDateTime"] : ["EventDate"]) {
      const date = record.fields[field];
      if (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || (contract.expectedSourceDate !== null && date.slice(0, 10) !== contract.expectedSourceDate)) temporalFindings.push(finding("AUDIT_TEMPORAL_MISMATCH", "The meeting date is invalid or outside the explicit source-date contract.", "BLOCKING", record.id, field));
    }
  }
  add("TEMPORAL", true, "Preserve source event date and time separately and honor an explicit contracted date.", temporalFindings);
  add("GEOGRAPHIC", true, "Canonical geographic subject and publisher-bound body must agree; body names alone cannot establish jurisdiction.", identityFindings.concat(comparisonFindings(identityFields, "AUDIT_GEOGRAPHIC_MISMATCH")));

  const provenanceFindings: WorkerFinding[] = [];
  for (const basis of ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] as const) if (!context.startedFrom.includes(basis)) provenanceFindings.push(finding("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT", `Independent starting basis ${basis} is missing.`));
  if (context.startedFrom.includes("OUR_SUMMARY")) provenanceFindings.push(finding("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT", "Producer summaries are not an admissible starting context."));
  if (!captured || captured.evidence.contentHash !== extraction.contentHash || captured.evidence.acquiredByAttemptId !== extraction.acquiredByAttemptId) provenanceFindings.push(finding("AUDIT_ARTIFACT_IDENTITY_MISMATCH", "The extraction does not bind to a held artifact and its machine-owned hash/acquisition Attempt."));
  for (const entry of independent) if (!context.publisherSurfaces.some((surface) => publisherHost(surface) === host(entry.evidence.canonicalUrl))) provenanceFindings.push(finding("AUDIT_NON_FIRST_PARTY_EVIDENCE", `Artifact ${entry.evidence.artifactId} is not on an independently named publisher surface.`));
  if (civicClerk) for (const entry of independent) {
    const wanted = `${contract.publisherSlug}.api.civicclerk.com`;
    const odataContext = object(entry.root) ? entry.root["@odata.context"] : null;
    if (host(entry.evidence.canonicalUrl) !== wanted || typeof odataContext !== "string" || host(odataContext) !== wanted) provenanceFindings.push(finding("AUDIT_IDENTITY_MISMATCH", `Artifact ${entry.evidence.artifactId} URL and OData publisher context must bind ${wanted}.`));
  }
  for (const record of extraction.records) for (const field of Object.keys(record.fields)) {
    if (!extraction.spans.some((span) => record.evidenceSpanIds.includes(span.id) && span.recordId === record.id && span.field === field)) provenanceFindings.push(finding("AUDIT_UNSUPPORTED_EVIDENCE_SPAN", "A claimed field has no linked supporting evidence span.", "BLOCKING", record.id, field));
  }
  for (const span of extraction.spans) {
    const entry = independent.find((item) => item.evidence.artifactId === span.artifactId);
    const record = records.get(span.recordId);
    let quoted: unknown;
    try { quoted = JSON.parse(span.quote); } catch { quoted = undefined; }
    const pathField = span.jsonPointer.split("/").at(-1)?.replace(/~1/g, "/").replace(/~0/g, "~");
    const parentPath = span.jsonPointer.slice(0, span.jsonPointer.lastIndexOf("/"));
    const parent = entry ? pointer(entry.root, parentPath) : null;
    if (!entry || span.contentHash !== entry.evidence.contentHash || span.offsetUnit !== "UTF16_CODE_UNITS" || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || entry.evidence.text.slice(span.start, span.end) !== span.quote || !record || pathField !== span.field || !object(parent) || sourceId(parent, contract) !== record.id || pointer(entry.root, span.jsonPointer) !== record.fields[span.field] || quoted !== record.fields[span.field]) {
      provenanceFindings.push(finding("AUDIT_UNSUPPORTED_EVIDENCE_SPAN", `Span ${span.id} does not support the claimed field in its exact source record.`, "BLOCKING", span.recordId, span.field));
    }
  }
  add("PROVENANCE", true, "Only machine-issued artifact identities and exact source spans support claims; model assertions confer no provenance.", provenanceFindings);

  const coverageFindings: WorkerFinding[] = [];
  const missing = [...expected.keys()].filter((id) => !records.has(id));
  if ((evidenceComplete && (missing.length || expected.size !== records.size)) || records.size !== extraction.records.length || extraction.actualRowCount !== extraction.records.length) coverageFindings.push(finding("AUDIT_DENOMINATOR_INCOMPLETE", `Independent ${globalClaim ? "source-universe" : "captured-artifact"} denominator=${expected.size}; unique claimed=${records.size}; reported=${extraction.actualRowCount}; omitted=${missing.join(",") || "none"}.`));
  for (const entry of sources) if (entry.declared !== null && entry.declared !== entry.rows.length) coverageFindings.push(finding("AUDIT_DENOMINATOR_INCOMPLETE", `Artifact ${entry.evidence.artifactId} declares ${entry.declared} rows and contains ${entry.rows.length}.`));
  if (extraction.declaredRowCount !== null && extraction.declaredRowCount !== extraction.actualRowCount) coverageFindings.push(finding("AUDIT_DENOMINATOR_INCOMPLETE", "The producer's declared and extracted row counts disagree."));
  const officialValues = new Map<string, { row: SourceRow; artifactId: string }>();
  for (const entry of independent) for (const row of entry.rows) {
    const id = sourceId(row, contract);
    if (!id) continue;
    const previous = officialValues.get(id);
    if (previous) for (const field of [...identityFields, ...temporalFields, ...stageFields, "EventLocation"]) {
      if (Object.prototype.hasOwnProperty.call(row, field) && Object.prototype.hasOwnProperty.call(previous.row, field) && row[field] !== previous.row[field]) coverageFindings.push(finding("AUDIT_OFFICIAL_CONTRADICTION", `First-party artifacts ${previous.artifactId} and ${entry.evidence.artifactId} disagree on ${field}; no supersession is established.`, "BLOCKING", id, field));
    }
    else officialValues.set(id, { row, artifactId: entry.evidence.artifactId });
  }
  add("COVERAGE", true, "Reconcile independent record identities, publisher counts, and conflicting first-party values.", coverageFindings, evidenceComplete);
  const readerFindings: WorkerFinding[] = [];
  if (candidate.renderedRecordCount !== null && candidate.renderedRecordCount !== expected.size) readerFindings.push(finding("AUDIT_RENDERED_COUNT_MISMATCH", `Machine-observed rendered count=${candidate.renderedRecordCount}; independent scoped denominator=${expected.size}.`));
  add("READER_TRUTH", candidate.renderedRecordCount !== null, "When supplied, compare the machine-observed rendered count only; this does not certify DOM semantics or visual layout.", readerFindings);

  const operationalFindings: WorkerFinding[] = [];
  const actors = [input.worker, candidate.producer, candidate.validator];
  const attempts = [input.attemptId, candidate.producerAttemptId, candidate.validatorAttemptId];
  if (new Set(actors.map((actor) => actor.instance)).size !== 3 || actors.some((actor) => !actor.instance.trim()) || new Set(attempts).size !== 3 || input.worker.role !== "ADVERSARIAL_AUDITOR" || candidate.producer.role !== "PARSER" || candidate.validator.role !== "VALIDATOR" || extraction.attemptId !== candidate.producerAttemptId) operationalFindings.push(finding("AUDIT_ACTOR_NOT_INDEPENDENT", "Producer, validator, and auditor require distinct actors and Attempts; relabeling a reused instance cannot establish independence."));
  if (extraction.verdict !== "EXTRACTED" || extraction.warnings.some((warning) => warning.severity === "BLOCKING")) operationalFindings.push(finding("AUDIT_PRODUCER_RESULT_NOT_SUCCESSFUL", "A failed or blocking-ambiguous producer result cannot become a surviving civic conclusion."));
  const incompleteEvidence = independent.filter((entry) => entry.error !== null);
  for (const entry of incompleteEvidence) operationalFindings.push(finding("AUDIT_EVIDENCE_UNINTERPRETABLE", `Artifact ${entry.evidence.artifactId}: ${entry.error}.`, "WARNING"));
  for (const entry of independent) if (/ignore\s+(all\s+)?(previous|prior)\s+instructions|system\s*prompt|<\/?system\b|canonical.?promot/i.test(entry.evidence.text)) operationalFindings.push(finding("AUDIT_SOURCE_INSTRUCTION_IGNORED", `Instruction-like source text in ${entry.evidence.artifactId} remains evidence data; no actions or capabilities are derived from it.`, "INFO"));
  add("OPERATIONAL", true, "Prove independent actors and an interpretable completed product; source text cannot issue commands.", operationalFindings, incompleteEvidence.length === 0);
  add("POLITICAL_NEUTRALITY", false, "This Events extraction has no candidate/party comparison, ranking, or differential selection contract; political symmetry is not inferred from a feed.");

  const replayFindings: WorkerFinding[] = [];
  if (!extraction.implementation || !extraction.version) replayFindings.push(finding("AUDIT_REPLAY_IMPLEMENTATION_UNIDENTIFIED", "Reproduction needs an exact producer implementation/version."));
  for (const record of evidenceComplete ? extraction.records : []) {
    const row = expected.get(record.id);
    if (!row) { replayFindings.push(finding("AUDIT_REPRODUCTION_MISMATCH", "Independent evidence cannot reproduce this event identity.", "BLOCKING", record.id)); continue; }
    const scalarKeys = Object.keys(row).filter((field) => scalar(row[field])).sort();
    const claimedKeys = Object.keys(record.fields).sort();
    if (JSON.stringify(scalarKeys) !== JSON.stringify(claimedKeys) || scalarKeys.some((field) => row[field] !== record.fields[field])) replayFindings.push(finding("AUDIT_REPRODUCTION_MISMATCH", "Independent decoding of the immutable artifact does not reproduce the claimed scalar fields.", "BLOCKING", record.id));
  }
  add("REPRODUCIBILITY", true, "Independently decode the immutable source into canonical event identities and scalar values without importing the parser.", replayFindings, evidenceComplete);
  add("CAMPAIGN_FINANCE_COVERAGE", false, "This Events extraction contains no filing, committee, contribution, or independent-expenditure relationship contract.");

  const attacks = AUDITOR_ATTACK_MODES.map((mode) => byMode.get(mode)!);
  const findings = attacks.flatMap((attack) => attack.findings);
  const verdict = attacks.some((attack) => attack.verdict === "BROKE") ? "BROKE"
    : attacks.some((attack) => attack.verdict === "INCONCLUSIVE") ? "INCONCLUSIVE" : "SURVIVED";
  return {
    role: "ADVERSARIAL_AUDITOR", attemptId: input.attemptId,
    producerAttemptId: candidate.producerAttemptId, validatorAttemptId: candidate.validatorAttemptId,
    verdict, startedFrom: context.startedFrom, attacks, findings,
    artifactIds: [...new Set([...independent.map((entry) => entry.evidence.artifactId), ...(context.surfaceEvidence?.map(e => e.artifactId) ?? [])])],
    survivingRecordCount: verdict === "SURVIVED" ? records.size : 0,
    reopenRequired: verdict === "BROKE",
  };
}
