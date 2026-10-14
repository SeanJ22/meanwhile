import { canonicalJson } from "../control-plane/repository/types.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import { listDoors, type DoorRecord } from "../doors/registry.ts";
import { readPollingDoor, POLLING_DOOR_KINDS } from "../ballot/polling-door-reader.ts";
import { votingSitesCandidate, votingSitesScopedSuccessor } from "../ballot/voting-sites-data-plane.ts";
import { readVotingSitesProjection } from "../ballot/voting-sites-server.ts";
import { readRegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { captureIntact, capturesForPublication, jobWorkerResults, latestParserResult, verifiedWorkerRecords, requirePublication } from "./worker-publication-evidence.ts";
import { section3Page, linkingPageFrom } from "../control-plane/promotion/section3.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { holdRawCapture } from "./raw-capture-vault.ts";
import { rawCaptureVault } from "./raw-capture-remote.ts";

export async function publishPollingDoor(input: {
  readonly store: RoutineDataStore; readonly door: DoorRecord;
  readonly capture: WorkerPublicationCapture; readonly jurisdictionName: string;
  readonly linkingCaptures?: readonly WorkerPublicationCapture[]; readonly now: string; readonly vault?: EvidenceStore;
}) {
  const capture = input.capture;
  const linkingPage = linkingPageFrom(capture.evidence.canonicalUrl, (input.linkingCaptures ?? []).filter(captureIntact).map(c => c.evidence));
  requirePublication(input.door.status !== "SUSPENDED" && section3Page({ url: capture.evidence.canonicalUrl, text: capture.evidence.text,
    retrievedAt: capture.observedAt, sourcePolicy: capture.sourcePolicy, linkingPage }, "VOTING_SITE", input.now).ok, "POLLING_SOURCE_NOT_ADMITTED");
  const jurisdiction = readPollingDoor({ ...input, linkingPage: linkingPage ?? undefined });
  const prior = await readVotingSitesProjection({ store: input.store, now: input.now, bypassCache: true });
  requirePublication(prior.kind === "PROMOTED" || prior.kind === "NOT_RECORDED", "POLLING_PRIOR_UNAVAILABLE");
  const held = prior.kind === "PROMOTED" ? prior.value : null;
  const base = prior.kind === "PROMOTED" ? prior.metadata.versionId : null;
  const candidate = votingSitesCandidate({ current: votingSitesScopedSuccessor(held, jurisdiction, input.now.slice(0, 10)),
    prior: held, failures: [], successfulAuthorityReads: 1,
    acquisition: [{ url: capture.evidence.canonicalUrl, contentType: "text/plain",
      ...await holdRawCapture(input.vault ?? rawCaptureVault(), "voting-sites", capture.evidence.text, "text/plain") }],
    requestedUrl: capture.evidence.canonicalUrl, finalUrl: capture.evidence.canonicalUrl,
    retrievedAt: input.now, carriedFromVersionId: base });
  const published = await processRegisteredManualCandidate(input.store, "voting-sites", candidate, input.now, base);
  const read = await readVotingSitesProjection({ store: input.store, now: input.now, bypassCache: true });
  requirePublication(published.promoted && read.kind === "PROMOTED" && read.metadata.versionId === published.promoted.versionId,
    `POLLING_TYPED_READBACK_FAILED:${published.candidate.failureDetail ?? "pointer not readable"}`);
  return { ...published, jurisdiction };
}

export async function publishWorkerPollingResults(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore;
  readonly workItemIds: readonly string[]; readonly now: string; readonly vault?: EvidenceStore;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
}) {
  const [{ results, readCapture }, doors, registry] = await Promise.all([jobWorkerResults(input.repos, input.workItemIds, input.readCapture),
    listDoors(input.repos.doors), readRegistryRuntimePrior(input.store, input.now)]);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = await input.repos.workItems.mustRead(id), plan = item.value.autonomousPlan;
    const parser = latestParserResult(results, id);
    if (!plan || plan.publication?.contractId !== "voting-sites" || !parser || parser.result.role !== "PARSER") continue;
    if (item.value.publicationOutcome?.workerResultId === parser.id && item.value.publicationOutcome.status === "PUBLISHED" &&
      item.value.publicationOutcome.sourceObservedAt) {
      report.push({ workItemId: id, outcome: item.value.publicationOutcome }); continue;
    }
    let candidateId: string | null = null, versionId: string | null = null;
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    try {
      requirePublication(plan.contract.schemaVersion === 2 && plan.contract.recordClass === "VOTING_SITE", "POLLING_CONTRACT_UNRESOLVED");
      const body = registry?.payload.registry.bodies.find(row => row.id === plan.publication!.bodyId);
      const divisionId = body?.ocdId ?? plan.publication.bodyId;
      const division = registry?.payload.registry.divisions.find(row => row.ocdId === divisionId);
      const matching = doors.doors.filter(door => door.status !== "SUSPENDED" && door.ocdId === divisionId &&
        (POLLING_DOOR_KINDS as readonly string[]).includes(door.kind) && plan.sourceRegistryReferences.includes(door.doorId));
      requirePublication(division?.label && matching.length === 1, "POLLING_EXACT_DOOR_OR_DIVISION_MISSING");
      const door = matching[0], primaryId = parser.result.artifactId;
      const captures = await capturesForPublication({ ...input, readCapture, workItemId: id, primaryId, results });
      const capture = captures.find(c => c.evidence.artifactId === primaryId)!;
      const checked = verifiedWorkerRecords({ plan, parser, captures, results, now: input.now });
      requirePublication(canonicalJson(checked.contract.extraction) === canonicalJson(JSON.parse(String(door.config.extraction))), "POLLING_REGISTERED_MAPPING_MISMATCH");
      const publication = await publishPollingDoor({ ...input, door, capture, linkingCaptures: captures, jurisdictionName: division.label });
      candidateId = publication.candidate.candidate.id; versionId = publication.promoted!.versionId;
      outcome = { at: input.now, workerResultId: parser.id, candidateId, versionId, status: "PUBLISHED",
        sourceObservedAt: capture.observedAt, sourceArtifactId: capture.evidence.artifactId,
        code: publication.confirmed ? "VERIFIED_RESULT_REUSED" : "OFFICIAL_POLLING_SITES_PUBLISHED",
        acceptedRecordIds: publication.jurisdiction.sites.map(site => site.id),
        detail: "Every verified official site row is held; unreported coordinates, elections and assignments remain unknown." };
    } catch (error) {
      outcome = { at: input.now, workerResultId: parser.id, candidateId, versionId, status: "HELD",
        code: "POLLING_PUBLICATION_HELD", detail: sanitizedErrorDiagnostic(error), recovery: "WORKER" };
    }
    const latest = await input.repos.workItems.mustRead(id);
    if (!await input.repos.workItems.compareAndSet(id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now)) throw new Error("Polling outcome changed during retention.");
    report.push({ workItemId: id, outcome });
  }
  return report;
}
