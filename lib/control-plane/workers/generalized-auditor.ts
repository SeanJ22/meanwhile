import { ATTACK_MODES, type AttackMode } from "../audit.ts";
import type { AuditAttackResult, AuditorResult, AuditorWorkerInput, GeneralizedCivicExtractionContract, WorkerFinding } from "./types.ts";
import { assertGeneralizedScope, inventoryRecordEvidence, recordIdentity, RecordEvidenceRefusal } from "./record-evidence.ts";
import { compareCandidateWithSource, stableValue, valuesOf, verifyExternalAuthorities } from "./record-verification.ts";
import { auditCoverage, recordOutcome } from "./audit-outcome.ts";
import { isQuotedExtraction, quotedSourceFindings } from "./quoted-proof.ts";

const finding = (code: string, detail: string, severity: WorkerFinding["severity"] = "BLOCKING", recordId?: string): WorkerFinding => ({ code, detail, severity, ...(recordId ? { recordId } : {}) });

export function auditGeneralizedExtraction(input: AuditorWorkerInput, contract: GeneralizedCivicExtractionContract): AuditorResult {
  const context = input.context;
  // Build the authoritative occurrence inventory before reading any candidate.
  // A record type with no parsing rule has no row inventory to build; its quotes are re-proved against the artifact itself below.
  const quoted = isQuotedExtraction(contract, input.candidate.extraction);
  const independent = context.evidence.map(evidence => {
    try { assertGeneralizedScope(contract, evidence); return { evidence, inventory: quoted ? null : inventoryRecordEvidence(evidence, contract.extraction), error: null }; }
    catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; return { evidence, inventory: null, error }; }
  });
  const candidate = input.candidate; const extraction = candidate.extraction;
  const captured = independent.find(entry => entry.evidence.artifactId === extraction.artifactId);
  const global = context.scope === "SOURCE_UNIVERSE" || candidate.claimsUniverseComplete || candidate.claimsAbsence;
  const scoped = global ? independent : captured ? [captured] : [];
  const allArtifacts = [...context.evidence, ...(context.surfaceEvidence ?? []), ...(context.authorityEvidence ?? [])];
  const attacks = new Map<AttackMode, AuditAttackResult>();
  const add = (mode: AttackMode, reason: string, findings: WorkerFinding[] = [], applicable = true, complete = true) => {
    attacks.set(mode, { mode, applicable, executed: applicable && complete, reason, findings,
      verdict: !applicable ? "NOT_APPLICABLE" : findings.some(f => f.severity === "BLOCKING") ? "BROKE" : !complete || findings.some(f => f.severity === "WARNING") ? "INCONCLUSIVE" : "SURVIVED" });
  };
  const routeFindings: WorkerFinding[] = [];
  const applicableRoutes = context.routes.filter(route => route.applicable && route.status !== "NOT_APPLICABLE");
  for (const route of applicableRoutes) {
    const held = route.artifactIds.length > 0 && route.artifactIds.every(id => allArtifacts.some(e => e.artifactId === id));
    // Another source not yet checked is a coverage number, never a reason to hold back a record that checked out.
    if (route.status !== "HELD" || !held || !candidate.coveredRouteIds.includes(route.routeId)) routeFindings.push(finding("AUDIT_ROUTE_REMAINS_OWED", `Official route ${route.routeId} remains ${route.status}; held=${held}. Counted in coverage; it holds back nothing.`, "INFO"));
  }
  const routesChecked = applicableRoutes.filter(route => route.status === "HELD" && route.artifactIds.length > 0 && route.artifactIds.every(id => allArtifacts.some(e => e.artifactId === id)) && candidate.coveredRouteIds.includes(route.routeId)).length;
  const contextReady = context.publisherSurfaces.length > 0 && applicableRoutes.length > 0 && context.methodVersion >= contract.methodVersion && contract.sourceScope.observationArtifactIds.every(id => allArtifacts.some(e => e.artifactId === id));
  if (!contextReady) routeFindings.push(finding("AUDIT_SOURCE_UNIVERSE_UNESTABLISHED", "Publisher observation evidence, route floor, or current method inventory is missing; the coverage number shows how much is unchecked.", "INFO"));
  add("SOURCE_UNIVERSE", "Count how much of the independently inherited publisher route floor is checked; sources not yet checked lower the coverage number and break nothing.", routeFindings);

  const identityFindings: WorkerFinding[] = [];
  if (context.subjectId !== contract.subjectId || extraction.subjectId !== context.subjectId || extraction.recordClass !== contract.recordClass || stableValue(extraction.contractMetadata?.jurisdiction ?? null) !== stableValue(contract.jurisdiction)) identityFindings.push(finding("AUDIT_IDENTITY_MISMATCH", "Canonical subject, jurisdiction, and record class do not match the independent contract."));
  add("IDENTITY", "Bind every record to its canonical subject and source key.", identityFindings);
  add("GEOGRAPHIC", "Preserve the explicit jurisdiction; a matching display name cannot establish geography.", identityFindings);
  const provenance: WorkerFinding[] = [];
  for (const basis of ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] as const) if (!context.startedFrom.includes(basis)) provenance.push(finding("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT", `Independent starting basis ${basis} is absent.`));
  if (context.startedFrom.includes("OUR_SUMMARY")) provenance.push(finding("AUDIT_STARTING_CONTEXT_NOT_INDEPENDENT", "Our own summary cannot establish the independent evidence base."));
  if (!captured || (!captured.inventory && !quoted)) provenance.push(finding("AUDIT_ARTIFACT_IDENTITY_MISMATCH", "No independently inventoried captured artifact supports the candidate."));
  for (const entry of independent) {
    if (!context.publisherSurfaces.some(surface => {
      const observed = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(entry.evidence.canonicalUrl)?.[1]?.toLowerCase();
      const named = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(surface)?.[1]?.toLowerCase() ?? surface.toLowerCase();
      return observed === named;
    })) provenance.push(finding("AUDIT_NON_FIRST_PARTY_EVIDENCE", `Artifact ${entry.evidence.artifactId} has no independently named publisher surface.`));
  }
  const sourceComparisons: WorkerFinding[] = [];
  if (captured && quoted) {
    // No parsing rule exists for this record type: re-prove every quote against the immutable artifact itself.
    sourceComparisons.push(...quotedSourceFindings(extraction, contract, captured.evidence));
  } else if (captured?.inventory) {
    try { sourceComparisons.push(...compareCandidateWithSource(extraction, contract, captured.evidence, captured.inventory)); }
    catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; sourceComparisons.push(finding(error.code, error.message)); }
  }
  provenance.push(...sourceComparisons.filter(f => /SPAN|PROVENANCE|ARTIFACT|QUOTE/.test(f.code)));
  add("PROVENANCE", "Try to falsify each quotation by its exact artifact, lexical range, field, and source record occurrence.", provenance);
  add("TEMPORAL", "Challenge only explicit source-date fields; retrieval time cannot establish a civic date.", sourceComparisons.filter(f => f.code === "SOURCE_DATE_MISMATCH"), Boolean(contract.dateFields?.length));

  const coverage: WorkerFinding[] = sourceComparisons.filter(f => !/SPAN|PROVENANCE|ARTIFACT|QUOTE|SOURCE_DATE/.test(f.code));
  const expected = new Map<string, Record<string, unknown>>();
  for (const entry of scoped) for (const row of entry.inventory?.rows ?? []) {
    const fields = valuesOf(row);
    try {
      const id = recordIdentity(fields, contract.identity); const previous = expected.get(id);
      if (previous && stableValue(previous) !== stableValue(fields)) coverage.push(finding("AUDIT_OFFICIAL_CONTRADICTION", `Independent captured records disagree for ${id}; supersession has not been established.`));
      expected.set(id, fields);
    } catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; coverage.push(finding(error.code, error.message)); }
  }
  if (global && !quoted) {
    const extractedIds = new Set(extraction.records.map(record => record.id));
    for (const record of extraction.records) if (!expected.has(record.id)) coverage.push(finding("AUDIT_RECORD_NOT_IN_SOURCE", "No independently inventoried source row has this identity.", "BLOCKING", record.id));
    const notYet = [...expected.keys()].filter(id => !extractedIds.has(id));
    if (notYet.length) coverage.push(finding("AUDIT_SOURCE_RECORDS_NOT_YET_EXTRACTED", `${notYet.length} of ${expected.size} independently inventoried source record(s) are not in this extraction yet; counted in coverage, and the records that are here are unaffected.`, "INFO"));
  }
  if (contract.verification.required && !contract.verification.authorities.length) coverage.push(finding("AUDIT_EXTERNAL_AUTHORITY_MISSING", "The contract requires an independent authority (a judgment call, rulings section 3) and none is established, so this record is not verified and no survivors are listed.", "WARNING"));
  // This is a challenge, not a new Validator receipt: it deliberately issues no verification timestamp.
  const externalSource = captured?.evidence ?? context.evidence[0];
  const external = externalSource ? verifyExternalAuthorities({ attemptId: input.attemptId, producerAttemptId: candidate.producerAttemptId, candidate: extraction,
    evidence: externalSource, authorityEvidence: context.authorityEvidence }, contract) : [];
  coverage.push(...external.flatMap(result => result.discrepancies.filter(f => f.code !== "VERIFICATION_TIMESTAMP_MISSING")));
  const complete = scoped.length > 0 && scoped.every(entry => entry.error === null && (entry.inventory !== null || quoted));
  add("COVERAGE", "Challenge captured identities, independent official contradictions, and explicit external denominator evidence.", coverage, true, complete);
  const absence = candidate.claimsAbsence || extraction.actualRowCount === 0;
  const absenceFindings = absence ? [finding("AUDIT_UNSUPPORTED_ABSENCE", "A capture, missing row, failed extraction, or unwitnessed route never establishes publisher absence.")] : [];
  add("NEGATIVE_SPACE", "An absence requires its own affirmative record evidence and full argument.", absenceFindings, absence);
  const operational: WorkerFinding[] = [];
  const actors = [input.worker, candidate.producer, candidate.validator]; const attempts = [input.attemptId, candidate.producerAttemptId, candidate.validatorAttemptId];
  if (new Set(actors.map(actor => actor.instance)).size !== 3 || actors.some(actor => !actor.instance) || new Set(attempts).size !== 3 || input.worker.role !== "ADVERSARIAL_AUDITOR" || candidate.producer.role !== "PARSER" || candidate.validator.role !== "VALIDATOR" || extraction.attemptId !== candidate.producerAttemptId) operational.push(finding("AUDIT_ACTOR_NOT_INDEPENDENT", "Three distinct producer, validator, and auditor actors and Attempts are required."));
  if (extraction.verdict !== "EXTRACTED" || extraction.warnings.some(f => f.severity !== "INFO")) operational.push(finding("AUDIT_PRODUCER_RESULT_NOT_SUCCESSFUL", "Unresolved producer warnings cannot establish a surviving civic conclusion."));
  for (const entry of independent) if (entry.error) operational.push(finding("AUDIT_EVIDENCE_UNINTERPRETABLE", `${entry.evidence.artifactId}: ${entry.error.message}`, "WARNING"));
  add("OPERATIONAL", "Challenge independent execution and interpretability; source text never grants capabilities.", operational, true, complete);
  add("REPRODUCIBILITY", "Reproduce mapped source values from immutable evidence without invoking the producer.", sourceComparisons, true, complete);
  add("READER_TRUTH", "Compare a rendered count only when the source has an independent row inventory.", !quoted && candidate.renderedRecordCount !== null && candidate.renderedRecordCount !== expected.size ? [finding("AUDIT_RENDERED_COUNT_MISMATCH", "Observed rendered record count differs from independently inventoried source identities.")] : [], !quoted && candidate.renderedRecordCount !== null);
  add("PROCEDURAL_STAGE", "No procedural-stage interpretation is authorized by this source scalar extraction contract.", [], false);
  add("POLITICAL_NEUTRALITY", "This extraction performs no candidate ranking, recommendation, or differential filtering.", [], false);
  add("CAMPAIGN_FINANCE_COVERAGE", "Scalar record extraction does not establish contribution, committee, or expenditure chain completeness.", [], false);
  const ordered = ATTACK_MODES.map(mode => attacks.get(mode)!); const findings = ordered.flatMap(attack => attack.findings);
  const verdict = ordered.some(attack => attack.verdict === "BROKE") ? "BROKE" : ordered.some(attack => attack.verdict === "INCONCLUSIVE") ? "INCONCLUSIVE" : "SURVIVED";
  const localExternal = new Set(external.flatMap(result => result.discrepancies.filter(f => f.recordId && f.severity !== "INFO" && f.code !== "VERIFICATION_TIMESTAMP_MISSING")));
  const coverageAttack = attacks.get("COVERAGE")!;
  // Unchecked is not broken: an audit that could not interpret its evidence, or left a warning open, lists no survivors and pulls nothing.
  const unresolved = !complete || ordered.some(attack => attack.verdict === "INCONCLUSIVE") || coverageAttack.findings.some(f => f.severity === "WARNING" && !localExternal.has(f));
  const unsafeIds = new Set([...localExternal].map(f => f.recordId).filter((id): id is string => Boolean(id)));
  const recordIds = extraction.records.map(record => record.id);
  const { brokenRecordIds, survivingRecordIds: intact } = recordOutcome(recordIds, findings, unsafeIds);
  const survivingRecordIds = unresolved ? [] : intact;
  const sourceRecords = quoted ? null : global ? expected.size : captured?.inventory ? captured.inventory.rows.length : null;
  return { role: "ADVERSARIAL_AUDITOR", attemptId: input.attemptId, producerAttemptId: candidate.producerAttemptId, validatorAttemptId: candidate.validatorAttemptId,
    verdict, startedFrom: context.startedFrom, attacks: ordered, findings, artifactIds: [...new Set(allArtifacts.map(e => e.artifactId))], survivingRecordIds, survivingRecordCount: survivingRecordIds.length,
    brokenRecordIds, coverage: auditCoverage({ routesApplicable: applicableRoutes.length, routesChecked, sourceRecords, extractedRecords: extraction.records.length }), reopenRequired: verdict === "BROKE" };
}
