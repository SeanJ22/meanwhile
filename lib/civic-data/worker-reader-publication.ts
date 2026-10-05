import type { AutonomousWorkPlan } from "../control-plane/workers/autonomous-plan.ts";
import type { WorkerResultRecord, FieldValue } from "../control-plane/workers/types.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { readCompletedWorkerResults } from "../control-plane/repository/worker-completion.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { readRegistryRuntimePrior, type RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { RoutineDataStore } from "./store.ts";
import type { CuratedReaderProjection, ManualProjectionPackage, ManualProjectionPrior } from "./manual-projections.ts";
import { readManualProjectionPrior } from "./manual-projections.ts";
import { prepareManualProjectionSuccessor } from "./manual-successor.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { auditPull, captureIntact, capturesForPublication, section3SourceReceipt, latestParserResult, verifiedWorkerRecords, requirePublication, validatorObservation } from "./worker-publication-evidence.ts";
import { readValidatorManual, writeValidatorLessons, type ValidatorObservation } from "../control-plane/promotion/validator-manual.ts";
import { workerReaderClassMatches, isWorkerReaderContract, type WorkerReaderContract } from "./worker-reader-contracts.ts";
import { createHash } from "node:crypto";
import { officialFilingIssue } from "./official-filings.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { ArtifactRecord } from "../control-plane/repository/types.ts";
import { publishHeldElectionOffices } from "./worker-held-elections.ts";
import { localHeldCaptureReader } from "./worker-publication-context.ts";
import { recordPublishedPageDoor, withPageDoor } from "./worker-page-doors.ts";
import { workerBallotContestsPackage, publishWorkerBallotContestsResults } from "./worker-ballot-contests.ts";
import { EVERYDAY_TOPIC_IDS, everydayRoutingProjectionFromRecords, type EverydayRoutingRecord } from "../routing/everyday.ts";
import { publicRecordIssue, recordNewPublicKinds } from "./public-records.ts";
import type { PublicRecord } from "./types.ts";
import { manualPayloadScope } from "./scoped-manual-contracts.ts";
import { governmentBudgetIssue, governmentBudgetRecordId, budgetResponsibilityRole, budgetAuthorityKind } from "./government-budgets.ts";
import { GOVERNMENT_FINANCE_FIELDS, governmentFinanceKind, governmentFinanceFact, type GovernmentFinanceField } from "./government-finance.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
const text = (value: FieldValue | undefined) => typeof value === "string" ? value : "";
const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const COMMENT_FIELDS = ["commentPeriod", "commentPeriodDetail", "signup", "writtenComment", "attend", "timeLimit"] as const;

/** Current independently checked fields advance; omitted details keep their
 * actual prior GOOD authority and date instead of blocking the whole rule. */
export function inheritVerifiedCommentDetails(input: ManualProjectionPackage, prior: ManualProjectionPrior | null): ManualProjectionPackage {
  requirePublication(input.contractId === "comment-access", "COMMENT_CONTRACT_MISMATCH");
  const current = (input.payload as CuratedReaderProjection).records;
  const before = (prior?.payload as CuratedReaderProjection | undefined)?.records ?? [];
  const retainedUrls = new Set<string>();
  const records = current.map(row => {
    const matches = before.filter(old => old.bodyId === row.bodyId);
    requirePublication(matches.length <= 1, "PRIOR_BODY_IDENTITY_CONFLICT");
    const old = matches[0];
    const fields: Record<string, unknown> = { ...row, id: old?.id ?? row.id };
    const fieldSources: NonNullable<CommentAccess["fieldSources"]> = {};
    for (const field of COMMENT_FIELDS) {
      const missing = row[field] === null || row[field] === undefined || (field === "commentPeriod" && row[field] === "UNKNOWN");
      if (missing && old?.[field] !== undefined && old[field] !== null && !(field === "commentPeriod" && old[field] === "UNKNOWN")) {
        const priorField = (old.fieldSources as CommentAccess["fieldSources"])?.[field];
        const sourceUrl = priorField?.sourceUrl ?? String(old.sourceUrl);
        requirePublication(prior?.sourceReceipt.sources.some(source => source.reviewOutcome !== "BLOCKED" &&
          [source.requestedUrl, source.finalUrl].includes(sourceUrl)), "PRIOR_FIELD_AUTHORITY_MISSING");
        fields[field] = old[field];
        fieldSources[field] = { sourceUrl, collectedAt: priorField?.collectedAt ?? String(old.collectedAt),
          verifiedAt: priorField?.verifiedAt ?? (typeof old.verifiedAt === "string" ? old.verifiedAt : null), retainedFromVersion: prior!.versionId };
        retainedUrls.add(sourceUrl);
      } else if (row[field] !== null && row[field] !== undefined) {
        fieldSources[field] = { sourceUrl: String(row.sourceUrl), collectedAt: String(row.collectedAt), verifiedAt: String(row.verifiedAt) };
      }
    }
    return { ...fields, id: String(fields.id), fieldSources };
  });
  const retained = prior?.sourceReceipt.sources.filter(source => [source.requestedUrl, source.finalUrl].some(url => retainedUrls.has(url))) ?? [];
  const sources = [...input.sourceReceipt.sources, ...retained];
  return { ...input, payload: { kind: "comment-access", records }, sourceReceipt: { ...input.sourceReceipt,
    sources: sources.filter((source, index) => sources.findIndex(other => canonicalJson(other) === canonicalJson(source)) === index) } };
}

/** Field-specific conversion to existing readers; no arbitrary model payloads.
 * Null fields mean unacquired, never an assertion that a service is absent. */
export function workerReaderPackage(input: Parameters<typeof verifiedWorkerRecords>[0] & { registry: RegistryRuntimePrior | null }): ManualProjectionPackage {
  return workerReaderPackageWithPulls(input).package;
}

/** The package plus the published member ids an auditor's pull takes out of the next version (DP-15). */
export function workerReaderPackageWithPulls(input: Parameters<typeof verifiedWorkerRecords>[0] & { registry: RegistryRuntimePrior | null }):
  { readonly package: ManualProjectionPackage; readonly pulledMemberIds: ReadonlySet<string> } {
  if (input.plan.publication?.contractId === "ballot-contests") return { package: workerBallotContestsPackage(input).package, pulledMemberIds: new Set() };
  const target = input.plan.publication;
  requirePublication(target && isWorkerReaderContract(target.contractId), "READER_CONTRACT_UNRESOLVED");
  const contractId = target.contractId as Exclude<WorkerReaderContract, "ballot-contests">;
  const checked = verifiedWorkerRecords({ ...input, pullRemoves: true });
  requirePublication(workerReaderClassMatches(contractId, checked.contract.recordClass), "READER_CLASS_MISMATCH");
  const body = input.registry?.payload.registry.bodies.find(body => body.id === target.bodyId);
  const place = contractId === "public-records" ? input.registry?.payload.registry.divisions.find(row => row.ocdId === target.bodyId) : null;
  requirePublication(body?.name || place?.label, "CANONICAL_BODY_MISSING");
  const rowFor = (record: (typeof checked.extraction.records)[number]) => {
    const f = record.fields;
    requirePublication(words(text(f.bodyName)) === words(body?.name ?? place!.label), "CANONICAL_BODY_MISMATCH");
    if (contractId === "public-records") {
      const allowed = new Set(["bodyName", "title", "kindLabel", "sourceSentence"]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "PUBLIC_RECORD_FIELD_UNSUPPORTED");
      const ocdId = body?.ocdId ?? place?.ocdId;
      const row = { id: `public-record:${createHash("sha256").update(canonicalJson([body?.id ?? ocdId, f.title, f.kindLabel, checked.primary.evidence.canonicalUrl])).digest("hex")}`,
        kind: "PUBLIC_RECORD" as const, bodyId: body?.id ?? null, ocdId: ocdId!, title: text(f.title), kindLabel: text(f.kindLabel),
        sourceSentence: text(f.sourceSentence), sourceUrl: checked.primary.evidence.canonicalUrl, capturedAt: checked.primary.observedAt };
      requirePublication(publicRecordIssue(row) === null, `PUBLIC_RECORD_SOURCE_UNVERIFIED:${publicRecordIssue(row)}`);
      requirePublication([row.sourceSentence, row.kindLabel, row.title].every(value => checked.primary.evidence.text.includes(value)), "PUBLIC_RECORD_SENTENCE_NOT_HELD");
      return row;
    }
    requirePublication(body?.name, "CANONICAL_BODY_MISSING");
    if (contractId === "government-budgets") {
      const kind = checked.contract.recordClass;
      if (kind === "PUBLIC_RECORD") {
        requirePublication(Object.keys(f).every(field => ["bodyName", "title", "kindLabel", "sourceSentence", ...GOVERNMENT_FINANCE_FIELDS].includes(field)), "GOVERNMENT_FINANCE_FIELD_UNSUPPORTED");
        const detailKind = governmentFinanceKind(text(f.kindLabel));
        requirePublication(detailKind, "GOVERNMENT_FINANCE_KIND_UNRESOLVED");
        requirePublication([f.title, f.kindLabel, f.sourceSentence].every(value => typeof value === "string" && checked.primary.evidence.text.includes(value)), "GOVERNMENT_FINANCE_WORDS_NOT_HELD");
        const details: Partial<Record<GovernmentFinanceField, string | number | null>> = {};
        for (const key of GOVERNMENT_FINANCE_FIELDS) {
          const value = f[key];
          if (value === undefined) continue;
          requirePublication(value === null || typeof value === "string" || typeof value === "number", "GOVERNMENT_FINANCE_DETAIL_UNREADABLE");
          details[key] = value;
        }
        return governmentFinanceFact({ bodyId: body.id, ocdId: body.ocdId!, government: body.name,
          detailKind, title: text(f.title), sourceSentence: text(f.sourceSentence), sourceUrl: checked.primary.evidence.canonicalUrl,
          sourceHash: (checked.primary.evidence.sourceDocument?.contentHash ?? checked.primary.evidence.contentHash).replace(/^sha256-/, ""),
          capturedAt: checked.primary.observedAt, details });
      }
      const allowed = new Set(["bodyName", "sourceSentence", ...(kind === "BUDGET_RESPONSIBILITY" ? ["role", "responsible", "authorityKind"] :
        ["title", "fiscalYear", "fiscalStart", "fiscalEnd", "version", "budgetVersion", "documentUrl"])]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "BUDGET_FIELD_UNSUPPORTED");
      const common = { id: governmentBudgetRecordId([body.id, kind, text(f.fiscalYear), text(f.title), text(f.role), text(f.version), text(f.budgetVersion)]),
        bodyId: body.id, ocdId: body.ocdId, government: body.name, kind, sourceSentence: text(f.sourceSentence),
        sourceUrl: checked.primary.evidence.canonicalUrl, capturedAt: checked.primary.observedAt };
      let row;
      if (kind === "BUDGET_RESPONSIBILITY") row = { ...common, role: budgetResponsibilityRole(text(f.role)), responsible: text(f.responsible), authorityKind: budgetAuthorityKind(text(f.authorityKind)) };
      else {
        const document = input.captures.find(capture => capture.evidence.canonicalUrl === f.documentUrl && captureIntact(capture));
        requirePublication(document && document.evidence.text.trim(), "BUDGET_DOCUMENT_NOT_HELD");
        const linkingPage = linkingPageFrom(document.evidence.canonicalUrl, input.captures.filter(captureIntact).map(capture => capture.evidence));
        requirePublication(section3Page({ url: document.evidence.canonicalUrl, text: document.evidence.text,
          retrievedAt: document.observedAt, linkingPage, sourcePolicy: document.sourcePolicy }, kind, input.now).ok, "BUDGET_DOCUMENT_SOURCE_UNVERIFIED");
        row = { ...common, title: text(f.title), fiscalYear: text(f.fiscalYear), documentUrl: text(f.documentUrl),
          documentHash: (document.evidence.sourceDocument?.contentHash ?? document.evidence.contentHash).replace(/^sha256-/, ""),
          ...(kind === "BUDGET_AMENDMENT" ? { budgetVersion: text(f.budgetVersion) } : {
            version: text(f.version), fiscalStart: text(f.fiscalStart) || null, fiscalEnd: text(f.fiscalEnd) || null }) };
      }
      requirePublication(checked.primary.evidence.text.includes(common.sourceSentence) && governmentBudgetIssue(row) === null,
        `BUDGET_SOURCE_UNVERIFIED:${governmentBudgetIssue(row) ?? "saved sentence is missing"}`);
      return row;
    }
    if (contractId === "official-filings") {
      const publisherDivisionId = body.ocdId;
      requirePublication(publisherDivisionId && input.registry?.payload.registry.divisions.some(row => row.ocdId === publisherDivisionId), "FILING_TERRITORY_UNRESOLVED");
      const territories = input.registry?.payload.registry.divisions.filter(row => row.state.toUpperCase() === checked.contract.jurisdiction.state.toUpperCase() &&
        words(row.label) === words(text(f.jurisdictionName))) ?? [];
      requirePublication(territories.length === 1, "FILING_EXACT_JURISDICTION_UNRESOLVED");
      const facts = Object.fromEntries(Object.entries(f).filter(([key]) => !["bodyName", "documentUrl", "jurisdictionName"].includes(key)));
      const id = `official-filing:${createHash("sha256").update(canonicalJson([body.id, territories[0].ocdId, checked.contract.recordClass, f.documentUrl,
        f.candidateName ?? f.committeeName, f.office ?? f.filingPeriod])).digest("hex")}`;
      const moneyFields = ["amount", "receipts", "expenditures", "cashOnHand"];
      const hasMoney = moneyFields.some(field => typeof facts[field] === "number") && typeof facts.filingPeriod === "string";
      const kind = checked.contract.recordClass === "CAMPAIGN_FINANCE_FILING" && !hasMoney ? "CAMPAIGN_FINANCE_DOCUMENT" : checked.contract.recordClass;
      if (kind === "CAMPAIGN_FINANCE_DOCUMENT") for (const field of moneyFields) delete facts[field];
      const row = { id, kind, bodyId: body.id, ocdId: territories[0].ocdId, bodyName: body.name, jurisdictionName: territories[0].label,
        sourceUrl: checked.primary.evidence.canonicalUrl, documentUrl: f.documentUrl, collectedAt: checked.primary.observedAt, verifiedAt: input.now, facts };
      requirePublication(officialFilingIssue(row) === null, `FILING_FIELDS_UNVERIFIED:${officialFilingIssue(row)}`);
      return row;
    }
    if (contractId === "everyday-routing") {
      const allowed = new Set(["bodyName", "topicId", "serviceZip", "service", "serviceAreaEvidence", "phone", "email", "requestUrl", "note"]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "SERVICE_FIELD_UNSUPPORTED");
      requirePublication((EVERYDAY_TOPIC_IDS as readonly string[]).includes(text(f.topicId)) && /^\d{5}$/.test(text(f.serviceZip)) &&
        text(f.service).trim() && text(f.serviceAreaEvidence).trim(), "SERVICE_APPLICABILITY_UNVERIFIED");
      requirePublication(text(f.phone).trim() || text(f.email).trim() || /^https:\/\//.test(text(f.requestUrl)), "SERVICE_CHANNEL_MISSING");
      requirePublication(!f.requestUrl || /^https:\/\//.test(text(f.requestUrl)), "SERVICE_CHANNEL_INVALID");
      return { id: `everyday-contact:${f.topicId}:${f.serviceZip}:${checked.primary.evidence.canonicalUrl}`, kind: "CONTACT",
        topicId: f.topicId, zip: f.serviceZip, serviceAreaEvidence: f.serviceAreaEvidence,
        contact: { topicId: f.topicId, zips: [f.serviceZip], body: body.name, service: f.service,
          phone: f.phone ?? null, email: f.email ?? null, requestUrl: f.requestUrl ?? null, note: f.note ?? null,
          sourceUrl: checked.primary.evidence.canonicalUrl, sourceOrg: checked.primary.evidence.sourceId,
          collectedAt: checked.primary.observedAt, verification: "PAGE_FETCHED" } };
    }
    if (contractId === "ballot-navigation") {
      const allowed = new Set(["bodyName", "state", "kind", "url", "coverage", "coverageEvidence", "note"]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "NAVIGATION_FIELD_UNSUPPORTED");
      requirePublication(text(f.state) === checked.contract.jurisdiction.state.toUpperCase() && /^[A-Z]{2}$/.test(text(f.state)) &&
        f.coverage === "STATEWIDE" && text(f.coverageEvidence).trim(), "NAVIGATION_APPLICABILITY_UNVERIFIED");
      requirePublication(["POLLING_PLACE_LINK", "REGISTRATION_LINK"].includes(text(f.kind)) && /^https:\/\//.test(text(f.url)), "NAVIGATION_ROUTE_INVALID");
      return { id: `ballot-navigation:${f.kind}:${f.state}`, kind: f.kind, sourceUrl: checked.primary.evidence.canonicalUrl,
        coverageEvidence: f.coverageEvidence, value: { state: f.state, url: f.url,
          label: f.kind === "POLLING_PLACE_LINK" ? "Find your polling place" : "Check whether you're registered to vote",
          note: f.note ?? "", sourceOrg: checked.primary.evidence.sourceId,
          verification: `Source and independent authority verified at ${input.now}.`, verifiedAt: input.now } };
    }
      requirePublication(["YES", "NO", "UNKNOWN"].includes(text(f.commentPeriod)) && text(f.commentPeriodDetail).trim(), "COMMENT_RULE_MISSING");
      const allowed = new Set(["bodyName", "commentPeriod", "commentPeriodDetail", "signup", "writtenComment", "attend", "timeLimit"]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "COMMENT_FIELD_UNSUPPORTED");
      return { id: `comment:${body!.id}`, bodyId: body!.id, ocdId: body!.ocdId ?? null,
        commentPeriod: f.commentPeriod, commentPeriodDetail: f.commentPeriodDetail,
        signup: f.signup ?? null, writtenComment: f.writtenComment ?? null, attend: f.attend ?? null, timeLimit: f.timeLimit ?? null,
        sourceUrl: checked.primary.evidence.canonicalUrl, collectedAt: checked.primary.observedAt, verifiedAt: input.now };
  };
  const records = checked.extraction.records.map(rowFor);
  requirePublication(records.length === checked.extraction.records.length && new Set(records.map(r => r.id)).size === records.length, "READER_IDENTITY_COLLISION");
  // A pulled record that cannot be turned into a row never reached the version, so it has nothing to remove.
  const pulledMemberIds = new Set(checked.pulledRecords.flatMap(record => { try { return [String(rowFor(record).id)]; } catch { return []; } }));
  const documentUrls = new Set(records.flatMap(row => "documentUrl" in row ? [String(row.documentUrl)] : []));
  const budgetCaptures = input.captures.filter(capture => captureIntact(capture) &&
    (documentUrls.has(capture.evidence.canonicalUrl) || checked.sourceReceipt.sources.some(source => source.finalUrl === capture.evidence.canonicalUrl)));
  return { pulledMemberIds, package: { contractId, version: `worker:${input.parser.id}`, sourceThrough: input.now,
    sourceReceipt: contractId === "government-budgets" ? section3SourceReceipt(budgetCaptures, input.now, `section3-validator:${input.parser.id}`,
      "Every adopted budget or amendment document is a complete saved official capture linked to its exact fiscal year and government.") : checked.sourceReceipt,
    payload: contractId === "everyday-routing"
      ? everydayRoutingProjectionFromRecords(records as unknown as EverydayRoutingRecord[]) : { kind: contractId, records } } };
}

export async function publishWorkerReaderResults(input: {
  repos: ControlPlaneRepositories; store: RoutineDataStore; contractId: WorkerReaderContract; workItemIds: readonly string[]; now: string;
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  /** Reads a held page straight from the vault by its artifact record; enables reuse of any job's saved evidence. */
  readHeld?: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
}) {
  if (input.contractId === "ballot-contests") return publishWorkerBallotContestsResults(input);
  const results = await readCompletedWorkerResults(input.repos);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  // Owed election work with no extraction yet: the government's saved election pages are read in code.
  if (input.contractId === "ballot-navigation") {
    const held = input.workItemIds.filter(id => !latestParserResult(results, id));
    if (held.length) report.push(...await publishHeldElectionOffices({ repos: input.repos, store: input.store, workItemIds: held, now: input.now,
      readHeld: input.readHeld ?? localHeldCaptureReader() }));
  }
  // The Validator reads what earlier passes learned before it checks anything, and writes back once at the end.
  const manual = await readValidatorManual(input.repos);
  const learned: ValidatorObservation[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan: AutonomousWorkPlan | undefined = item.autonomousPlan;
    // The Validator's §3 check runs here on the latest extraction; no auditor or Send is needed.
    const parser = latestParserResult(results, id);
    if (!parser || plan?.publication?.contractId !== input.contractId) continue;
    // A BROKE audit after this publication is re-checked once; otherwise a published or worker-owed result waits for a newer extraction.
    const pull = auditPull(results, parser);
    if (item.publicationOutcome?.workerResultId === parser.id && item.publicationOutcome.recovery !== "PUBLISHER" && !(pull && pull.at > item.publicationOutcome.at)) {
      report.push({ workItemId: id, outcome: item.publicationOutcome }); continue;
    }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>, candidateId: string | null = null, versionId: string | null = null;
    let workerChecksComplete = false, captures: WorkerPublicationCapture[] = [], wentLive = 0;
    try {
      requirePublication(parser.result.role === "PARSER" && plan.contract.schemaVersion === 2, "INPUT_CHAIN_MISSING");
      captures = await capturesForPublication({ repos: input.repos, workItemId: id, primaryId: parser.result.artifactId, results, readCapture: input.readCapture, officialLinks: manual.officialLinks });
      const registry = await readRegistryRuntimePrior(input.store, input.now);
      const built = workerReaderPackageWithPulls({ plan, parser, captures, registry, now: input.now, results });
      const checked = built.package;
      const prior = await readManualProjectionPrior(input.contractId, input.store, input.now,
        manualPayloadScope(input.contractId, requiredManualProductionContract(input.contractId).scope, checked.payload));
      const before = (prior?.payload as CuratedReaderProjection | undefined)?.records ?? [];
      const prepared = input.contractId === "comment-access" ? inheritVerifiedCommentDetails(checked, prior) : checked;
      const delivered = (prepared.payload as CuratedReaderProjection).records;
      const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(prepared, input.store, input.now, built.pulledMemberIds);
      const composed = candidate.readModel as CuratedReaderProjection;
      requirePublication(delivered.every(row => composed.records.some(published => canonicalJson(published) === canonicalJson(row))),
        `READER_FACTS_HELD:${candidate.excludedFacts?.map(row => `${row.code}: ${row.detail}`).join("; ") ?? "typed record was withheld"}`);
      candidateId = candidate.id;
      workerChecksComplete = true;
      const published = await processRegisteredManualCandidate(input.store, input.contractId, candidate, input.now, expectedBaseVersionId);
      if (!published.promoted) {
        if (published.candidate.failureCode !== "PROMOTION_BASE_CHANGED") workerChecksComplete = false;
        throw new Error(`WORKER_PUBLICATION_READER_GATE_HELD:${published.candidate.failureDetail ?? published.candidate.state}`);
      }
      versionId = published.promoted.versionId;
      const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
        requiredManualProductionContract(input.contractId), published.promoted, input.now);
      if (readback?.status !== "PASS") throw new Error(`WORKER_PUBLICATION_READER_READBACK_FAILED:${readback?.detail ?? "missing receipt"}`);
      const changes = publicationRecordChanges({ previousVersionId: prior?.versionId ?? null,
        accepted: delivered.map(row => ({ recordId: row.id, readerId: row.id, value: row, previous: before.find(old => old.id === row.id) })) });
      outcome = { at: input.now, workerResultId: parser.id, status: "PUBLISHED", code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `${input.contractId}: ${delivered.length} record(s) passed §3 on the saved official page, promotion completed and the typed Reader readback passed.`, candidateId, versionId,
        ...changes, acceptedRecordIds: delivered.map(row => row.id) };
      wentLive = delivered.length;
      if (input.contractId === "public-records") await recordNewPublicKinds(input.repos, delivered as unknown as readonly PublicRecord[], input.now);
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      const recovery = workerChecksComplete || !detail.startsWith("WORKER_PUBLICATION_") ? "PUBLISHER" : "WORKER";
      outcome = { at: input.now, workerResultId: parser.id, status: "HELD", code: detail.split(":")[0],
        detail: `${detail}. ${recovery === "WORKER" ? "Automatic evidence or contract repair remains owed" : "The existing publisher retries the retained result"}; no manual approval is required.`, recovery, candidateId, versionId };
    }
    if (plan) outcome = withPageDoor(outcome, captures[0], plan.contract.recordClass);
    const latest = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
    if (plan) await recordPublishedPageDoor({ repos: input.repos, page: captures[0], recordClass: plan.contract.recordClass, published: wentLive, now: input.now });
    if (plan) learned.push(validatorObservation({ plan, workItemId: id, page: captures[0], captures, published: wentLive, outcome }));
  }
  await writeValidatorLessons(input.repos, learned, input.now);
  return report;
}
