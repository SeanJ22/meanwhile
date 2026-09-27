import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource, verifyExternalAuthorities } from "../control-plane/workers/record-verification.ts";
import type { WorkerEvidence, WorkerResultRecord } from "../control-plane/workers/types.ts";
import { projectReaderRoster, type BodyRoster } from "../registry/body-rosters.ts";
import type { OfficialCandidacyBridgeRow, RegistryRuntimePackage, RegistryRuntimePrior, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { ManualSourceReview } from "./types.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { readCompletedWorkerResults } from "../control-plane/repository/worker-completion.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate } from "../registry/runtime-data-plane.ts";
import type { RoutineDataStore } from "./store.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { isScheduled, scheduleObligation } from "../control-plane/scheduler/obligation.ts";

export interface WorkerPublicationCapture {
  readonly evidence: WorkerEvidence;
  /** Latest successful network observation, not the time an old blob was replayed. */
  readonly observedAt: string;
  readonly httpStatus: number | null;
  readonly transport: string;
  readonly partial: boolean;
}

const requireThat = (value: unknown, reason: string): void => { if (!value) throw new Error(reason); };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const words = (text: string) => text.replace(/<[^>]*>/g, " ").replace(/&(?:amp|nbsp);/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A dedicated connection to the existing registry reader door. It accepts
 * completed independent worker results and re-reads their exact evidence.
 * Merely staged, extracted, or capture-only results cannot become a package. */
export function workerRosterPublication(input: {
  readonly plan: AutonomousWorkPlan;
  readonly parser: WorkerResultRecord;
  readonly validator: WorkerResultRecord;
  readonly auditor: WorkerResultRecord;
  readonly captures: readonly WorkerPublicationCapture[];
  readonly prior: RegistryRuntimePrior;
  readonly now: string;
}): RegistryRuntimePackage {
  const { plan, parser, validator, auditor, prior, now } = input;
  const contract = plan.contract;
  const target = plan.publication;
  requireThat(target?.contractId === "registry-runtime-bindings" && contract.schemaVersion === 2 &&
    contract.recordClass === "OFFICIAL_ROSTER" && plan.auditScope === "SOURCE_UNIVERSE", "ROSTER_PUBLICATION_CONTRACT_UNRESOLVED");
  if (!target || contract.schemaVersion !== 2) throw new Error("ROSTER_PUBLICATION_CONTRACT_UNRESOLVED");
  const extraction = parser.result;
  const verification = validator.result;
  const audit = auditor.result;
  requireThat(extraction.role === "PARSER" && verification.role === "VALIDATOR" && audit.role === "ADVERSARIAL_AUDITOR", "ROSTER_PUBLICATION_WORKER_ROLES_INVALID");
  if (extraction.role !== "PARSER" || verification.role !== "VALIDATOR" || audit.role !== "ADVERSARIAL_AUDITOR") throw new Error("ROSTER_PUBLICATION_WORKER_ROLES_INVALID");
  requireThat(extraction.verdict === "EXTRACTED" && verification.verdict === "PASS" && audit.verdict === "SURVIVED" && !audit.reopenRequired &&
    extraction.warnings.every(f => f.severity === "INFO") && verification.findings.every(f => f.severity === "INFO") && audit.findings.every(f => f.severity === "INFO"), "ROSTER_REQUIRED_VERIFICATION_UNFINISHED");
  requireThat(new Set([parser.worker.instance, validator.worker.instance, auditor.worker.instance]).size === 3 &&
    new Set([parser.attemptId, validator.attemptId, auditor.attemptId]).size === 3 &&
    parser.workItemId === validator.workItemId && parser.workItemId === auditor.workItemId &&
    verification.producerAttemptId === parser.attemptId && audit.producerAttemptId === parser.attemptId && audit.validatorAttemptId === validator.attemptId &&
    validator.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(validator.id), "ROSTER_INDEPENDENT_WORKER_CHAIN_INVALID");
  requireThat([parser, validator, auditor].every(record => canonicalJson(record.completion.completedTask.workerTask?.contract) === canonicalJson(contract)) &&
    auditor.completion.completedTask.workerTask?.auditScope === "SOURCE_UNIVERSE", "ROSTER_WORKER_CONTRACT_MISMATCH");
  requireThat(contract.verification.required && contract.verification.authorities.length > 0 &&
    ["name", "office"].every(field => contract.requiredFields.includes(field) && contract.verification.authorities.some(a => a.comparison.kind === "RECORD_VALUES" && a.comparison.fields.includes(field))), "ROSTER_MEMBERSHIP_VERIFICATION_MISSING");
  const primary = input.captures.find(capture => capture.evidence.artifactId === extraction.artifactId);
  requireThat(primary, "ROSTER_PRIMARY_CAPTURE_MISSING");
  if (!primary) throw new Error("ROSTER_PRIMARY_CAPTURE_MISSING");
  const requiredIds = new Set([extraction.artifactId, ...contract.verification.authorities.flatMap(a => [...a.artifactIds, ...a.authorityEvidenceArtifactIds])]);
  const captures = input.captures.filter(capture => requiredIds.has(capture.evidence.artifactId));
  requireThat(new Set(captures.map(c => c.evidence.artifactId)).size === requiredIds.size, "ROSTER_AUTHORITY_CAPTURE_MISSING");
  for (const capture of captures) {
    const age = Date.parse(now) - Date.parse(capture.observedAt);
    const freshness = scheduleObligation({ id: parser.workItemId, subjectId: contract.subjectId, recordClass: contract.recordClass,
      routeId: capture.evidence.methodRouteId, active: true, readerImpactAt: plan.freshness?.readerImpactAt ?? null,
      observedChangeRateHours: plan.freshness?.observedChangeRateHours ?? null, declaredCycleHours: plan.freshness?.declaredCycleHours ?? null,
      lastWorkedAt: capture.observedAt }, Date.parse(now));
    requireThat(Number.isFinite(age) && age >= 0 && isScheduled(freshness) && Date.parse(freshness.nextDueAt) > Date.parse(now) && capture.transport === "REACHABLE" && !capture.partial &&
      capture.httpStatus !== null && capture.httpStatus >= 200 && capture.httpStatus < 300 &&
      capture.evidence.contentHash === `sha256-${digest(capture.evidence.text)}`, "ROSTER_CAPTURE_STALE_OR_UNPROVEN");
  }
  const source = inventoryRecordEvidence(primary.evidence, contract.extraction);
  requireThat(compareCandidateWithSource(extraction, contract, primary.evidence, source).length === 0, "ROSTER_SOURCE_REPLAY_FAILED");
  const external = verifyExternalAuthorities({ attemptId: validator.attemptId, producerAttemptId: parser.attemptId, candidate: extraction,
    evidence: primary.evidence, authorityEvidence: captures.map(c => c.evidence), verifiedAt: now }, contract);
  requireThat(external.length > 0 && external.every(check => check.verdict === "PASS"), "ROSTER_AUTHORITY_REPLAY_FAILED");
  requireThat(extraction.actualRowCount > 0 && verification.validatedRecordCount === extraction.actualRowCount &&
    audit.survivingRecordCount === extraction.actualRowCount, "ROSTER_FALSE_ZERO_OR_COUNT_MISMATCH");
  const body = prior.payload.registry.bodies.find(body => body.id === target.bodyId);
  requireThat(body?.name && words(primary.evidence.text).includes(words(body.name)), "ROSTER_CANONICAL_BODY_ASSERTION_MISSING");
  if (!body?.name) throw new Error("ROSTER_CANONICAL_BODY_ASSERTION_MISSING");
  // Known-answer checks exercise the same source comparison used for publication.
  // A fabricated person and a removed source row must both be rejected.
  const altered = { ...extraction, records: extraction.records.map((record, index) => index ? record : { ...record, fields: { ...record.fields, name: "UNSUPPORTED_CONTROL_PERSON_72e9" } }) };
  requireThat(compareCandidateWithSource(altered, contract, primary.evidence, source).length > 0 &&
    compareCandidateWithSource({ ...extraction, records: [] }, contract, primary.evidence, source).length > 0, "ROSTER_PUBLICATION_CONTROLS_FAILED");
  const previous = prior.payload.bodyRosters.find(roster => roster.bodyId === body.id);
  const proposed: BodyRoster = {
    bodyId: body.id, bodyName: body.name, sourceUrl: primary.evidence.canonicalUrl, sourceOrg: contract.sourceScope.publisher,
    collectedAt: primary.observedAt.slice(0, 10), partisanship: previous?.partisanship ?? "UNDETERMINED",
    ...(previous?.partisanshipSourceUrl ? { partisanshipSourceUrl: previous.partisanshipSourceUrl } : {}),
    members: extraction.records.map(record => {
      const name = record.fields.name, officeTitle = record.fields.office;
      requireThat(typeof name === "string" && name.trim() && typeof officeTitle === "string" && officeTitle.trim(), "ROSTER_PERSON_FIELDS_MISSING");
      const matching = previous?.members.filter(member => member.name === name && member.officeTitle === officeTitle) ?? [];
      requireThat(matching.length <= 1, "ROSTER_PRIOR_PERSON_IDENTITY_CONFLICT");
      return { ...(matching[0] ?? { id: `roster:${body.id}#${digest(record.id).slice(0, 16)}`, termNote: null, email: null, phone: null, websiteUrl: null }),
        name: name as string, officeTitle: officeTitle as string };
    }),
  };
  const rendered = projectReaderRoster(proposed);
  requireThat(rendered.roster.members.length === extraction.records.length && rendered.dispositions.every(d => d.state === "READER_ELIGIBLE"), "ROSTER_READER_IDENTITY_UNRESOLVED");
  requireThat(rendered.roster.members.every((member, i) => member.name === extraction.records[i].fields.name && member.officeTitle === extraction.records[i].fields.office), "ROSTER_RENDERING_MISMATCH");
  // Officeholding and ballot candidacy are separate assertions. New verified
  // holders reach readers while the already owed election work checks candidacy;
  // an unchecked link is never represented as no candidacy or no funding.
  const pendingCandidacies: OfficialCandidacyBridgeRow[] = rendered.roster.members
    .filter(member => !prior.payload.officialCandidacies.rows.some(row => row.holder.id === member.id))
    .map(member => ({ holder: { id: member.id, name: member.name, officeTitle: member.officeTitle,
      divisions: body.ocdId ? [body.ocdId] : [], authority: "REGISTRY_BODY_ROSTER", sourceUrl: primary.evidence.canonicalUrl },
      status: "NOT_CHECKED", candidacy: null, unresolvedCandidacyIds: [],
      reason: "Officeholding independently verified. Ballot candidacy verification remains owed; no candidacy or absence is asserted." }));
  const sourceReviews: ManualSourceReview[] = captures.map(capture => ({ requestedUrl: capture.evidence.canonicalUrl,
    finalUrl: capture.evidence.canonicalUrl, publisher: capture.evidence.sourceId, sourceClass: "OFFICIAL_PUBLISHER",
    retrievedAt: capture.observedAt, httpStatus: capture.httpStatus!, rawHash: capture.evidence.contentHash.slice(7),
    reviewedEvidence: `Independent worker chain ${parser.id}, ${validator.id}, ${auditor.id}; exact source and authority replay, canonical body assertion, nonzero counts, reader symmetry and two known-answer controls passed.`, reviewOutcome: "SUPPORTED" }));
  return { contractId: "registry-runtime-bindings", version: `worker-roster:${auditor.id}`, sourceThrough: now,
    sourceReceipt: { contractVersion: 1, reviewedAt: now, reviewedBy: `worker-roster-publication:${auditor.worker.instance}`, sources: sourceReviews },
    // The existing source-scoped door carries unchanged members on their own
    // prior authority. This review supplies only the independently checked roster.
    payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions: [], bodies: [] },
      bodyRosters: [rendered.roster], rosterReaderDispositions: rendered.dispositions,
      statewideExecutives: [], officialCandidacies: { ...prior.payload.officialCandidacies, rows: pendingCandidacies },
      officialPhotos: { photos: [] }, rosterPhotos: {} } };
}

/** Called by the existing registry producer for completed work from an Admin
 * Send. Every accepted body advances independently; a hold goes back onto its
 * original work item so the existing repair worker receives the exact defect. */
export async function publishWorkerRosterResults(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore;
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}): Promise<readonly { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[]> {
  const records = await readCompletedWorkerResults(input.repos);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan = item.autonomousPlan;
    const own = records.filter(record => record.workItemId === id);
    const auditor = own.filter(record => record.result.role === "ADVERSARIAL_AUDITOR")
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0];
    if (!auditor || !plan?.ownerInstructions?.length) throw new Error(`ROSTER_OWNER_WORK_INSTRUCTIONS_MISSING:${id}`);
    if (item.publicationOutcome?.workerResultId === auditor.id && item.publicationOutcome.recovery !== "PUBLISHER") { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null;
    let versionId: string | null = null;
    try {
      const validator = own.find(record => auditor.inputResultIds.includes(record.id) && record.result.role === "VALIDATOR");
      const parser = own.find(record => auditor.inputResultIds.includes(record.id) && record.result.role === "PARSER");
      if (!validator || !parser || parser.result.role !== "PARSER" || plan.contract.schemaVersion !== 2) throw new Error("ROSTER_WORKER_INPUT_CHAIN_MISSING");
      const ids = [...new Set([parser.result.artifactId, ...plan.contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])])];
      const captures = await Promise.all(ids.map(artifact => input.readCapture(artifact, records)));
      const prior = await readRegistryRuntimePrior(input.store, input.now);
      if (!prior) throw new Error("ROSTER_PRIOR_READER_AUTHORITY_MISSING");
      const prepared = workerRosterPublication({ plan, parser, validator, auditor, captures, prior, now: input.now });
      const before = prior.payload.bodyRosters.find(roster => roster.bodyId === plan.publication?.bodyId)?.members ?? [];
      const counts = { added: 0, changed: 0, reused: 0 };
      for (const member of prepared.payload.bodyRosters[0].members) {
        const previous = before.find(held => held.id === member.id);
        if (!previous) counts.added++;
        else if (canonicalJson(previous) === canonicalJson(member)) counts.reused++;
        else counts.changed++;
      }
      const candidate = registryRuntimeCandidate(prepared, { prior });
      requireThat(canonicalJson((candidate.readModel as RegistryRuntimeReadModel).bodyRosters.find(roster => roster.bodyId === plan.publication?.bodyId)) ===
        canonicalJson(prepared.payload.bodyRosters[0]), "ROSTER_READER_FACTS_HELD");
      candidateId = candidate.id;
      const published = await processRegisteredManualCandidate(input.store, "registry-runtime-bindings", candidate, input.now, prior.versionId);
      if (!published.promoted) throw new Error(`${published.candidate.failureCode === "PROMOTION_BASE_CHANGED" ? "PROMOTION_BASE_CHANGED" : "ROSTER_READER_GATE_HELD"}:${published.candidate.failureDetail ?? published.candidate.state}`);
      versionId = published.promoted.versionId;
      const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
        requiredManualProductionContract("registry-runtime-bindings"), published.promoted, input.now);
      if (readback?.status !== "PASS") throw new Error(`ROSTER_READER_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
      outcome = { at: input.now, workerResultId: auditor.id, status: "PUBLISHED", code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `Independent roster checks passed, the existing registry door accepted ${versionId}, and typed reader readback passed. Remaining information families are still owed.`, candidateId, versionId, records: counts };
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      const code = detail.split(":")[0];
      const recovery = code.startsWith("ROSTER_") && !["ROSTER_PRIOR_READER_AUTHORITY_MISSING", "ROSTER_READER_READBACK_FAILED"].includes(code) ? "WORKER" : "PUBLISHER";
      outcome = { at: input.now, workerResultId: auditor.id, status: "HELD", code: detail.split(":")[0],
        detail: `${detail}. ${recovery === "WORKER" ? "Continue verification or source repair through the existing worker" : "Retry the existing publication operation with the verified evidence retained"}; no owner publication approval is required.`, recovery, candidateId, versionId };
    }
    // The data operation is already durable. Failure to store this receipt is
    // an accounting/recovery failure, never permission to mark it as published.
    const current = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, current.revision, { ...current.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
  }
  return report;
}
