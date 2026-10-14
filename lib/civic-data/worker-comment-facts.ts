import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { readValidatorManual } from "../control-plane/promotion/validator-manual.ts";
import { factClocks } from "../facts/clocks.ts";
import { publishCommentFacts } from "../facts/comment-facts.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { readRegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { parserFieldSources } from "./field-sources.ts";
import type { RoutineDataStore } from "./store.ts";
import { publicationCaptureReaders } from "./worker-publication-context.ts";
import { auditPull, capturesForPublication, jobWorkerResults, latestParserResult } from "./worker-publication-evidence.ts";
import { recordPublishedPageDoor, withPageDoor } from "./worker-page-doors.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/** Each owed comment-rule extraction becomes facts on its body, one rule at a time. */
export async function publishOwedCommentFacts(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore; readonly facts: FactDb & { readonly query: Query };
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  readonly readHeld?: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
}): Promise<readonly { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[]> {
  if (!input.workItemIds.length) return [];
  const clocks = factClocks((await input.repos.adminConfig.read("current"))?.value ?? null);
  const captureReaders = await publicationCaptureReaders(input.repos, input.readCapture, input.readHeld);
  const { results, readCapture } = await jobWorkerResults(input.repos, input.workItemIds, captureReaders.readCapture);
  const manual = await readValidatorManual(input.repos);
  const registry = await readRegistryRuntimePrior(input.store, input.now);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan = item.autonomousPlan;
    const parser = latestParserResult(results, id);
    if (!parser || parser.result.role !== "PARSER" || plan?.publication?.contractId !== "comment-access" || plan.contract.schemaVersion !== 2) continue;
    const pull = auditPull(results, parser);
    if (item.publicationOutcome?.workerResultId === parser.id && item.publicationOutcome.status !== "HELD" && !(pull && pull.at > item.publicationOutcome.at)) {
      report.push({ workItemId: id, outcome: item.publicationOutcome });
      continue;
    }
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let captures: WorkerPublicationCapture[] = [];
    try {
      const extraction = parser.result;
      captures = await capturesForPublication({ repos: input.repos, workItemId: id, primaryId: extraction.artifactId, results, readCapture, officialLinks: manual.officialLinks });
      const capture = captures.find(c => c.evidence.artifactId === extraction.artifactId);
      if (!capture) throw new Error("COMMENT_PAGE_NOT_SAVED");
      const bodyId = plan.publication.bodyId;
      const body = registry?.payload.registry.bodies.find(row => row.id === bodyId) ?? null;
      let live = 0, added = 0, reused = 0, blanks = 0;
      for (const record of extraction.records.filter(record => !pull?.recordIds.has(record.id) && !pull?.all)) {
        const outcomes = await publishCommentFacts(input.facts, { body: { id: bodyId, name: body?.name ?? null,
          state: plan.jurisdiction.toUpperCase().slice(0, 2), parentId: body?.ocdId ?? null }, capture, producedBy: parser.id,
        reading: { fields: record.fields, fieldSources: parserFieldSources(record.id, record.fields, extraction.spans, captures, input.now) } }, clocks, new Date(input.now));
        live += outcomes.filter(row => !("blank" in row)).length;
        added += outcomes.filter(row => "decision" in row && row.decision === "PUBLISH").length;
        reused += outcomes.filter(row => "decision" in row && row.decision === "CONFIRM").length;
        blanks += outcomes.filter(row => "blank" in row).length;
      }
      outcome = await withPageDoor(input.repos, { at: input.now, workerResultId: parser.id, status: live === 0 ? "HELD" : blanks ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: live === 0 ? "COMMENT_FACTS_BLANK" : "VERIFIED_RESULT_PUBLISHED",
        detail: `${live} comment rule facts checked against ${capture.evidence.canonicalUrl}; ${blanks} stay open as blanks with their reasons.`,
        records: { added, changed: 0, reused },
        ...(live === 0 ? { recovery: "WORKER" as const } : {}), candidateId: null, versionId: null }, capture, plan.contract.recordClass);
    } catch (error) {
      const detail = sanitizedErrorDiagnostic(error);
      outcome = { at: input.now, workerResultId: parser.id, status: "HELD", code: detail.split(":")[0]!, detail, recovery: "WORKER", candidateId: null, versionId: null };
    }
    const current = await input.repos.workItems.mustRead(id);
    await input.repos.workItems.compareAndSet(id, current.revision, { ...current.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
    await recordPublishedPageDoor({ repos: input.repos, page: captures[0], recordClass: plan.contract.recordClass, bodyId: plan.publication.bodyId,
      ocdId: plan.contract.jurisdiction.canonicalId, workItemId: id,
      published: outcome.status === "HELD" ? 0 : 1, now: input.now });
  }
  return report;
}
