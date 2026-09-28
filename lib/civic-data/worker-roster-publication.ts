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
import { materializeBodyDirectoryWork, workerBodyDirectoryPackage } from "./worker-body-directory.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";

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
  requireThat(extraction.verdict === "EXTRACTED" && verification.extractionVerdict === "PASS" &&
    extraction.warnings.every(f => f.severity === "INFO"), "ROSTER_REQUIRED_VERIFICATION_UNFINISHED");
  requireThat(new Set([parser.worker.instance, validator.worker.instance, auditor.worker.instance]).size === 3 &&
    new Set([parser.attemptId, validator.attemptId, auditor.attemptId]).size === 3 &&
    parser.workItemId === validator.workItemId && parser.workItemId === auditor.workItemId &&
    verification.producerAttemptId === parser.attemptId && audit.producerAttemptId === parser.attemptId && audit.validatorAttemptId === validator.attemptId &&
    validator.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(parser.id) && auditor.inputResultIds.includes(validator.id), "ROSTER_INDEPENDENT_WORKER_CHAIN_INVALID");
  requireThat([parser, validator, auditor].every(record => canonicalJson(record.completion.completedTask.workerTask?.contract) === canonicalJson(contract)) &&
    auditor.completion.completedTask.workerTask?.auditScope === "SOURCE_UNIVERSE", "ROSTER_WORKER_CONTRACT_MISMATCH");
  requireThat(contract.verification.required && contract.verification.authorities.length > 0 &&
    ["name", "office"].every(field => contract.requiredFields.includes(field) && contract.verification.authorities.some(a =>
      ["RECORD_VALUES", "RECORD_VALUES_SUBSET"].includes(a.comparison.kind) && a.comparison.fields.includes(field))), "ROSTER_MEMBERSHIP_VERIFICATION_MISSING");
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
  // Only person-scoped disagreements may be isolated. An authority, source,
  // route, actor, or denominator problem remains a whole-chain hold even if
  // one profile happened to agree with a candidate row.
  requireThat(external.length > 0 && external.every(check => check.discrepancies.every(f => f.severity === "INFO" || f.recordId)), "ROSTER_AUTHORITY_REPLAY_FAILED");
  const replayLocalCodes = new Set(external.flatMap(check => check.discrepancies.filter(f => f.severity !== "INFO" && f.recordId).map(f => `${f.code}|${f.recordId}|${f.field ?? ""}`)));
  const localFinding = (f: { severity: string; code: string; recordId?: string; field?: string }) =>
    f.severity === "INFO" || (Boolean(f.recordId) && replayLocalCodes.has(`${f.code}|${f.recordId}|${f.field ?? ""}`));
  requireThat(verification.findings.every(localFinding) && audit.findings.every(localFinding) &&
    audit.attacks.every(attack => attack.mode === "COVERAGE" ? attack.executed && attack.findings.every(localFinding) :
      attack.verdict === "SURVIVED" || attack.verdict === "NOT_APPLICABLE"), "ROSTER_GLOBAL_CHALLENGE_UNRESOLVED");
  const localBadIds = new Set(external.flatMap(check => check.discrepancies.filter(f => f.severity !== "INFO").map(f => f.recordId!)));
  const expectedSafeIds = extraction.records.map(record => record.id).filter(id => !localBadIds.has(id));
  const sameIds = (actual: readonly string[] | undefined) => actual !== undefined && actual.length === expectedSafeIds.length &&
    new Set(actual).size === actual.length && actual.every(id => expectedSafeIds.includes(id));
  const completeChain = verification.verdict === "PASS" && audit.verdict === "SURVIVED" && !audit.reopenRequired;
  requireThat((sameIds(verification.validatedRecordIds) || (completeChain && verification.validatedRecordCount === extraction.actualRowCount)) &&
    (sameIds(audit.survivingRecordIds) || (completeChain && audit.survivingRecordCount === extraction.actualRowCount)) &&
    verification.validatedRecordCount === expectedSafeIds.length && audit.survivingRecordCount === expectedSafeIds.length &&
    (completeChain || (verification.validatedRecordIds !== undefined && audit.survivingRecordIds !== undefined)), "ROSTER_ISOLATED_RECEIPTS_MISMATCH");
  const verifiedFields = new Map<string, Set<string>>();
  for (const check of external) {
    if (check.comparison.kind !== "RECORD_VALUES" && check.comparison.kind !== "RECORD_VALUES_SUBSET") continue;
    for (const id of check.verifiedRecordIds ?? []) {
      const fields = verifiedFields.get(id) ?? new Set<string>();
      for (const field of check.comparison.fields) fields.add(field);
      verifiedFields.set(id, fields);
    }
  }
  const memberVerified = (id: string) => ["name", "office"].every(field => verifiedFields.get(id)?.has(field));
  const safeIds = new Set(expectedSafeIds);
  const confirmedRecords = extraction.records.filter(record => safeIds.has(record.id) && memberVerified(record.id));
  requireThat(confirmedRecords.length > 0, "ROSTER_NO_INDEPENDENTLY_CONFIRMED_MEMBERS");
  requireThat(extraction.actualRowCount > 0 && expectedSafeIds.length > 0, "ROSTER_FALSE_ZERO_OR_COUNT_MISMATCH");
  const body = prior.payload.registry.bodies.find(body => body.id === target.bodyId);
  requireThat(body?.name && words(primary.evidence.text).includes(words(body.name)), "ROSTER_CANONICAL_BODY_ASSERTION_MISSING");
  if (!body?.name) throw new Error("ROSTER_CANONICAL_BODY_ASSERTION_MISSING");
  // Known-answer checks exercise the same source comparison used for publication.
  // A fabricated person and a removed source row must both be rejected.
  const altered = { ...extraction, records: extraction.records.map((record, index) => index ? record : { ...record, fields: { ...record.fields, name: "UNSUPPORTED_CONTROL_PERSON_72e9" } }) };
  requireThat(compareCandidateWithSource(altered, contract, primary.evidence, source).length > 0 &&
    compareCandidateWithSource({ ...extraction, records: [] }, contract, primary.evidence, source).length > 0, "ROSTER_PUBLICATION_CONTROLS_FAILED");
  const previous = prior.payload.bodyRosters.find(roster => roster.bodyId === body.id);
  const officePhoneCounts = new Map<string, number>();
  for (const record of extraction.records) {
    const phone = record.fields.phone;
    if (typeof phone === "string" && phone.trim()) officePhoneCounts.set(phone.trim(), (officePhoneCounts.get(phone.trim()) ?? 0) + 1);
  }
  const sourcedOptional = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
  const proposed: BodyRoster = {
    bodyId: body.id, bodyName: body.name, sourceUrl: primary.evidence.canonicalUrl, sourceOrg: contract.sourceScope.publisher,
    collectedAt: primary.observedAt.slice(0, 10), partisanship: previous?.partisanship ?? "UNDETERMINED",
    ...(previous?.partisanshipSourceUrl ? { partisanshipSourceUrl: previous.partisanshipSourceUrl } : {}),
    members: confirmedRecords.map(record => {
      const name = record.fields.name, officeTitle = record.fields.office;
      requireThat(typeof name === "string" && name.trim() && typeof officeTitle === "string" && officeTitle.trim(), "ROSTER_PERSON_FIELDS_MISSING");
      const matching = previous?.members.filter(member => member.name === name && member.officeTitle === officeTitle) ?? [];
      requireThat(matching.length <= 1, "ROSTER_PRIOR_PERSON_IDENTITY_CONFLICT");
      const old = matching[0];
      const { membershipSource: _oldMembership, retainedFieldSources: _oldRetained, ...identity } = old ?? { id: `roster:${body.id}#${digest(record.id).slice(0, 16)}`, termNote: null, email: null, phone: null, websiteUrl: null };
      const priorSource = old?.membershipSource ?? (previous ? { sourceUrl: previous.sourceUrl, sourceOrg: previous.sourceOrg, collectedAt: previous.collectedAt } : null);
      const retainedFieldSources: NonNullable<BodyRoster["members"][number]["retainedFieldSources"]> = {};
      const value = (field: "termNote" | "email" | "phone" | "websiteUrl", candidate: unknown): string | null => {
        const fresh = sourcedOptional(candidate);
        if (fresh !== null) return fresh;
        const retained = sourcedOptional(old?.[field]);
        if (retained !== null && priorSource) retainedFieldSources[field] = old?.retainedFieldSources?.[field] ?? priorSource;
        return retained;
      };
      // Public publisher and exact source spans establish an office route.
      // An explicit personal classification cannot enter the public card.
      const publicContact = record.fields.contactKind !== "PERSONAL";
      const phone = value("phone", publicContact ? record.fields.phone : null);
      const email = value("email", publicContact ? record.fields.email : null);
      // The roster page supports the link itself; it says nothing about
      // facts on the linked page until that page is separately read.
      const websiteUrl = value("websiteUrl", record.fields.websiteUrl);
      const termNote = value("termNote", record.fields.termNote);
      const freshOfficeContact = publicContact && (sourcedOptional(record.fields.phone) !== null || sourcedOptional(record.fields.email) !== null);
      return { ...identity,
        name: name as string, officeTitle: officeTitle as string, termNote, email, phone, websiteUrl,
        ...(freshOfficeContact ? { contactKind: "PUBLIC_OFFICE" as const } : old?.contactKind ? { contactKind: old.contactKind } : {}),
        ...(phone && freshOfficeContact ? { contactScope: (officePhoneCounts.get(phone) ?? 0) > 1 ? "SHARED_OFFICE" as const : old?.contactScope ?? "INDIVIDUAL_OFFICE" as const } : old?.contactScope ? { contactScope: old.contactScope } : {}),
        ...(Object.keys(retainedFieldSources).length ? { retainedFieldSources } : {}),
        // Source provenance belongs to the current verified membership;
        // retained optional facts name their own earlier authority above.
      };
    }),
  };
  const rendered = projectReaderRoster(proposed);
  requireThat(rendered.roster.members.length > 0, "ROSTER_NO_READER_ELIGIBLE_MEMBERS");
  requireThat(rendered.dispositions.length === confirmedRecords.length && rendered.roster.members.every(member =>
    proposed.members.some(source => source.id === member.id && canonicalJson(source) === canonicalJson(member))), "ROSTER_RENDERING_MISMATCH");
  for (const record of extraction.records.filter(record => !safeIds.has(record.id) || !memberVerified(record.id))) {
    rendered.dispositions.push({ sourceId: record.id, canonicalId: null, state: "IDENTITY_UNRESOLVED",
      reason: "The source row was captured but independent name and office confirmation or a person-specific contradiction remains owed; it is not a newly published member." });
  }
  if (previous) {
    // Neither a source-local omission nor an unconfirmed new row proves a
    // departure. Keep prior members on their actual older source and date.
    for (const member of previous.members.filter(old => !rendered.roster.members.some(current => current.id === old.id))) {
      rendered.roster.members.push({ ...member, membershipSource: member.membershipSource ?? {
        sourceUrl: previous.sourceUrl, sourceOrg: previous.sourceOrg, collectedAt: previous.collectedAt } });
      rendered.dispositions.push({ sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE",
        reason: "Retained from the prior verified roster; the incomplete update does not establish a departure." });
    }
  }
  // Officeholding and ballot candidacy are separate assertions. New verified
  // holders reach readers while the already owed election work checks candidacy;
  // an unchecked link is never represented as no candidacy or no funding.
  const pendingCandidacies: OfficialCandidacyBridgeRow[] = rendered.roster.members
    .filter(member => !prior.payload.officialCandidacies.rows.some(row => row.holder.id === member.id))
    .map(member => ({ holder: { id: member.id, name: member.name, officeTitle: member.officeTitle,
      divisions: body.ocdId ? [body.ocdId] : [], authority: "REGISTRY_BODY_ROSTER", sourceUrl: primary.evidence.canonicalUrl },
      status: "NOT_CHECKED", candidacy: null, unresolvedCandidacyIds: [],
      reason: "Officeholding independently verified or retained from its prior authority. Ballot candidacy verification remains owed; no candidacy or absence is asserted." }));
  const sourceReviews: ManualSourceReview[] = captures.map(capture => ({ requestedUrl: capture.evidence.canonicalUrl,
    finalUrl: capture.evidence.canonicalUrl, publisher: capture.evidence.sourceId, sourceClass: "OFFICIAL_PUBLISHER",
    retrievedAt: capture.observedAt, httpStatus: capture.httpStatus!, rawHash: (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash).slice(7),
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
    if (item.publicationOutcome?.workerResultId === auditor.id && item.publicationOutcome.recovery !== "PUBLISHER" &&
      item.publicationOutcome.code !== "ROSTER_READER_IDENTITY_UNRESOLVED") { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null;
    let versionId: string | null = null;
    try {
      const validator = own.find(record => auditor.inputResultIds.includes(record.id) && record.result.role === "VALIDATOR");
      const parser = own.find(record => auditor.inputResultIds.includes(record.id) && record.result.role === "PARSER");
      if (!validator || !parser || parser.result.role !== "PARSER" || plan.contract.schemaVersion !== 2) throw new Error("ROSTER_WORKER_INPUT_CHAIN_MISSING");
      const parsed = parser.result;
      const ids = [...new Set([parser.result.artifactId, ...plan.contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])])];
      const captures = await Promise.all(ids.map(artifact => input.readCapture(artifact, records)));
      const prior = await readRegistryRuntimePrior(input.store, input.now);
      if (!prior) throw new Error("ROSTER_PRIOR_READER_AUTHORITY_MISSING");
      const directory = plan.contract.recordClass === "OFFICIAL_BOARD_DIRECTORY"
        ? workerBodyDirectoryPackage({ plan, parser, validator, auditor, captures, prior, now: input.now }) : null;
      const prepared = directory?.prepared ?? workerRosterPublication({ plan, parser, validator, auditor, captures, prior, now: input.now });
      const before = prior.payload.bodyRosters.find(roster => roster.bodyId === plan.publication?.bodyId)?.members ?? [];
      const unresolved = directory?.unresolved ?? prepared.payload.rosterReaderDispositions.filter(row => row.state === "IDENTITY_UNRESOLVED").map(row => row.sourceId);
      const unresolvedIds = new Set(unresolved);
      const acceptedMembers = directory ? [] : parser.result.records.flatMap(record => {
        if (unresolvedIds.has(record.id)) return [];
        const matches = prepared.payload.bodyRosters[0]?.members.filter(member => member.name === record.fields.name && member.officeTitle === record.fields.office) ?? [];
        requireThat(matches.length <= 1, "ROSTER_ACCEPTED_MEMBER_AMBIGUOUS");
        const member = matches[0];
        if (!member || !prepared.payload.rosterReaderDispositions.some(row => row.sourceId === member.id && row.state === "READER_ELIGIBLE")) return [];
        return [{ recordId: record.id, memberId: member.id }];
      });
      if (!directory) requireThat(acceptedMembers.length > 0 && new Set(acceptedMembers.map(row => row.recordId)).size === acceptedMembers.length &&
        new Set(acceptedMembers.map(row => row.memberId)).size === acceptedMembers.length, "ROSTER_ACCEPTED_MEMBER_BINDING_INVALID");
      const bodyFacts = (row: RegistryRuntimeReadModel["registry"]["bodies"][number]) =>
        ({ name: row.name, bodyClass: row.bodyClass, ocdId: row.ocdId, homepageUrl: row.homepageUrl });
      if (directory) requireThat(directory.acceptedBodies.length === prepared.payload.registry.bodies.length &&
        new Set(directory.acceptedBodies.map(binding => binding.recordId)).size === directory.acceptedBodies.length &&
        new Set(directory.acceptedBodies.map(binding => binding.bodyId)).size === directory.acceptedBodies.length &&
        directory.acceptedBodies.every(binding => parsed.records.some(record => record.id === binding.recordId) &&
          prepared.payload.registry.bodies.some(body => body.id === binding.bodyId)), "DIRECTORY_ACCEPTED_BODY_BINDING_INVALID");
      const changes = publicationRecordChanges({ previousVersionId: prior.versionId, accepted: directory
        ? directory.acceptedBodies.map(binding => {
          const body = prepared.payload.registry.bodies.find(row => row.id === binding.bodyId)!;
          const previous = prior.payload.registry.bodies.find(row => row.id === body.id);
          return { recordId: binding.recordId, readerId: body.id, value: bodyFacts(body), previous: previous ? bodyFacts(previous) : undefined };
        })
        : acceptedMembers.map(binding => ({ recordId: binding.recordId, readerId: binding.memberId,
          value: prepared.payload.bodyRosters[0].members.find(row => row.id === binding.memberId)!,
          previous: before.find(row => row.id === binding.memberId) })) });
      const candidate = registryRuntimeCandidate(prepared, { prior });
      if (directory) requireThat(prepared.payload.registry.bodies.every(body => canonicalJson(body) ===
        canonicalJson((candidate.readModel as RegistryRuntimeReadModel).registry.bodies.find(row => row.id === body.id))), "WORKER_PUBLICATION_DIRECTORY_READER_FACTS_HELD");
      else requireThat(canonicalJson((candidate.readModel as RegistryRuntimeReadModel).bodyRosters.find(roster => roster.bodyId === plan.publication?.bodyId)) ===
        canonicalJson(prepared.payload.bodyRosters[0]), "ROSTER_READER_FACTS_HELD");
      candidateId = candidate.id;
      const published = await processRegisteredManualCandidate(input.store, "registry-runtime-bindings", candidate, input.now, prior.versionId);
      if (!published.promoted) throw new Error(`${published.candidate.failureCode === "PROMOTION_BASE_CHANGED" ? "PROMOTION_BASE_CHANGED" : "ROSTER_READER_GATE_HELD"}:${published.candidate.failureDetail ?? published.candidate.state}`);
      versionId = published.promoted.versionId;
      const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
        requiredManualProductionContract("registry-runtime-bindings"), published.promoted, input.now);
      if (readback?.status !== "PASS") throw new Error(`ROSTER_READER_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
      outcome = { at: input.now, workerResultId: auditor.id, status: unresolved.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: unresolved.length ? directory ? "DIRECTORY_ROWS_REQUIRE_REPAIR" : "ROSTER_IDENTITIES_REQUIRE_REPAIR" : published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `Independent ${directory ? "body directory" : "roster"} checks passed for ${directory ? prepared.payload.registry.bodies.length : prepared.payload.bodyRosters[0].members.length} reader ${directory ? "bodies" : "members"}, the existing registry door accepted ${versionId}, and typed reader readback passed. ${unresolved.length ? `${unresolved.length} source rows remain identity-unresolved: ${unresolved.join(", ")}. Repair these automatically; do not infer unsupported people or territory.` : "Remaining information families are still owed."}`,
        ...(unresolved.length ? { recovery: "WORKER" as const } : {}), candidateId, versionId, ...changes,
        ...(!directory ? { acceptedRecordIds: acceptedMembers.map(row => row.recordId), acceptedMembers } : {}),
        ...(directory ? { bodyIds: prepared.payload.registry.bodies.map(body => body.id),
          acceptedBodies: directory.acceptedBodies } : {}) };
      if (directory) {
        try { await materializeBodyDirectoryWork({ repos: input.repos, parent: { ...item, publicationOutcome: outcome }, bodies: prepared.payload.registry.bodies, now: input.now }); }
        catch { throw new Error("DIRECTORY_DOWNSTREAM_WRITE_FAILED:Verified bodies remain published; recover their downstream assignments on the next publisher cycle"); }
      }
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      const code = detail.split(":")[0];
      const recovery = (code.startsWith("ROSTER_") && !["ROSTER_PRIOR_READER_AUTHORITY_MISSING", "ROSTER_READER_READBACK_FAILED"].includes(code)) || code.startsWith("WORKER_PUBLICATION_") ? "WORKER" : "PUBLISHER";
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
