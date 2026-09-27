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
import { verifiedWorkerRecords, requirePublication } from "./worker-publication-evidence.ts";
import { WORKER_READER_CLASSES, isWorkerReaderContract, type WorkerReaderContract } from "./worker-reader-contracts.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
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
  const target = input.plan.publication;
  requirePublication(target && isWorkerReaderContract(target.contractId), "READER_CONTRACT_UNRESOLVED");
  const contractId = target.contractId as WorkerReaderContract;
  const checked = verifiedWorkerRecords(input);
  requirePublication(checked.contract.recordClass === WORKER_READER_CLASSES[contractId], "READER_CLASS_MISMATCH");
  const body = input.registry?.payload.registry.bodies.find(body => body.id === target.bodyId);
  requirePublication(body?.name, "CANONICAL_BODY_MISSING");
  const records = checked.extraction.records.map(record => {
    const f = record.fields;
    requirePublication(words(text(f.bodyName)) === words(body.name!), "CANONICAL_BODY_MISMATCH");
      requirePublication(["YES", "NO", "UNKNOWN"].includes(text(f.commentPeriod)) && text(f.commentPeriodDetail).trim(), "COMMENT_RULE_MISSING");
      const allowed = new Set(["bodyName", "commentPeriod", "commentPeriodDetail", "signup", "writtenComment", "attend", "timeLimit"]);
      requirePublication(Object.keys(f).every(field => allowed.has(field)), "COMMENT_FIELD_UNSUPPORTED");
      return { id: `comment:${body!.id}`, bodyId: body!.id, ocdId: body!.ocdId ?? null,
        commentPeriod: f.commentPeriod, commentPeriodDetail: f.commentPeriodDetail,
        signup: f.signup ?? null, writtenComment: f.writtenComment ?? null, attend: f.attend ?? null, timeLimit: f.timeLimit ?? null,
        sourceUrl: checked.primary.evidence.canonicalUrl, collectedAt: checked.primary.observedAt, verifiedAt: input.now };
  });
  requirePublication(records.length === checked.extraction.actualRowCount && new Set(records.map(r => r.id)).size === records.length, "READER_IDENTITY_COLLISION");
  return { contractId, version: `worker:${input.auditor.id}`, sourceThrough: input.now,
    sourceReceipt: checked.sourceReceipt, payload: { kind: contractId, records } };
}

export async function publishWorkerReaderResults(input: {
  repos: ControlPlaneRepositories; store: RoutineDataStore; contractId: WorkerReaderContract; workItemIds: readonly string[]; now: string;
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}) {
  const results = await readCompletedWorkerResults(input.repos);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan: AutonomousWorkPlan | undefined = item.autonomousPlan;
    const own = results.filter(r => r.workItemId === id);
    const auditor = own.filter(r => r.result.role === "ADVERSARIAL_AUDITOR").sort((a, b) => b.endedAt.localeCompare(a.endedAt) || b.id.localeCompare(a.id))[0];
    requirePublication(auditor && plan?.ownerInstructions?.length && plan.publication?.contractId === input.contractId, "OWNER_INSTRUCTIONS_MISSING");
    if (item.publicationOutcome?.workerResultId === auditor.id && item.publicationOutcome.recovery !== "PUBLISHER") {
      report.push({ workItemId: id, outcome: item.publicationOutcome }); continue;
    }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>, candidateId: string | null = null, versionId: string | null = null;
    let workerChecksComplete = false;
    try {
      const parser = own.find(r => auditor.inputResultIds.includes(r.id) && r.result.role === "PARSER");
      const validator = own.find(r => auditor.inputResultIds.includes(r.id) && r.result.role === "VALIDATOR");
      requirePublication(parser?.result.role === "PARSER" && validator && plan.contract.schemaVersion === 2, "INPUT_CHAIN_MISSING");
      const ids = [...new Set([parser.result.artifactId, ...plan.contract.verification.authorities.flatMap(a => [...a.artifactIds, ...a.authorityEvidenceArtifactIds])])];
      const captures = await Promise.all(ids.map(id => input.readCapture(id, results)));
      const registry = await readRegistryRuntimePrior(input.store, input.now);
      const checked = workerReaderPackage({ plan, parser, validator, auditor, captures, registry, now: input.now });
      const prior = await readManualProjectionPrior(input.contractId, input.store, input.now);
      const before = (prior?.payload as CuratedReaderProjection | undefined)?.records ?? [];
      const prepared = inheritVerifiedCommentDetails(checked, prior);
      const delivered = (prepared.payload as CuratedReaderProjection).records;
      const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(prepared, input.store, input.now);
      const composed = candidate.readModel as CuratedReaderProjection;
      requirePublication(delivered.every(row => composed.records.some(published => canonicalJson(published) === canonicalJson(row))), "READER_FACTS_HELD");
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
      const counts = { added: 0, changed: 0, reused: 0 };
      for (const row of delivered) {
        const old = before.find(old => old.id === row.id);
        // Verification dates alone are refreshed evidence, not a new finding.
        const facts = (row: CuratedReaderProjection["records"][number]) => canonicalJson(Object.fromEntries(Object.entries(row).filter(([key]) => !["collectedAt", "verifiedAt", "fieldSources"].includes(key))));
        if (!old) counts.added++; else if (facts(old) === facts(row)) counts.reused++; else counts.changed++;
      }
      outcome = { at: input.now, workerResultId: auditor.id, status: "PUBLISHED", code: published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `Independent ${input.contractId} verification passed, automatic promotion completed and the existing typed Reader readback passed.`, candidateId, versionId, records: counts };
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      const recovery = workerChecksComplete || !detail.startsWith("WORKER_PUBLICATION_") ? "PUBLISHER" : "WORKER";
      outcome = { at: input.now, workerResultId: auditor.id, status: "HELD", code: detail.split(":")[0],
        detail: `${detail}. ${recovery === "WORKER" ? "Automatic evidence or contract repair remains owed" : "The existing publisher retries the retained result"}; no manual approval is required.`, recovery, candidateId, versionId };
    }
    const latest = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
  }
  return report;
}
