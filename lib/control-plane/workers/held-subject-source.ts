import type { WorkerPublicationCapture } from "../../civic-data/worker-roster-publication.ts";
import { heldCaptureReader } from "../../civic-data/worker-publication-context.ts";
import type { EvidenceStore } from "../evidence/store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { fingerprint } from "../ids.ts";

const publicUrl = (value: string): boolean => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

/** One immutable original profile acquisition, scoped to its existing held work item. */
export async function readHeldSubjectSource(repos: ControlPlaneRepositories, workItemId: string, sourceRouteTaskId: string, artifactId: string) {
  const [item, route, records] = await Promise.all([repos.workItems.read(workItemId), repos.routeTasks.read(sourceRouteTaskId),
    repos.artifacts.readWhere(workItemId, ["artifactId"], artifactId)]);
  const record = records.find(row => row.artifactId === artifactId && row.workItemId === workItemId && row.routeTaskId === sourceRouteTaskId);
  if (!item || !route || route.value.workItemId !== workItemId || route.value.workerTask ||
    !route.value.routeId.startsWith("held-subject-details:") || !record || record.partial ||
    !publicUrl(record.canonicalUrl) || route.value.disposition?.disposition !== "INGESTED" ||
    !route.value.disposition.artifactIds.includes(artifactId)) return null;
  // Normal standing occurrences target their subject, while the HTTP capture records the requested URL.
  const sourceUrl = publicUrl(route.value.target) ? route.value.target
    : route.value.target === item.value.subject && route.value.routeId === `held-subject-details:${fingerprint([record.canonicalUrl])}`
      ? record.canonicalUrl : null;
  if (!sourceUrl) return null;
  const attempt = (await repos.attempts.read(record.attemptId))?.value;
  if (!attempt || attempt.workItemId !== workItemId || attempt.routeTaskId !== sourceRouteTaskId || attempt.outcome !== "COMPLETED" ||
    !attempt.artifactIds.includes(artifactId)) return null;
  return { item: item.value, route: route.value, sourceUrl, record, attempt };
}

export async function readHeldSubjectSourceCapture(vault: EvidenceStore, held: NonNullable<Awaited<ReturnType<typeof readHeldSubjectSource>>>): Promise<WorkerPublicationCapture> {
  const capture = await heldCaptureReader(vault, held.item.project)(held.record);
  if (!capture || capture.evidence.artifactId !== held.record.artifactId || capture.evidence.contentHash !== held.record.contentHash ||
    capture.evidence.canonicalUrl !== held.record.canonicalUrl || capture.evidence.acquiredByAttemptId !== held.record.attemptId ||
    capture.evidence.methodRouteId !== held.route.routeId || capture.observedAt !== capture.evidence.retrievedAt ||
    Date.parse(capture.observedAt) < Date.parse(held.attempt.startedAt) || Date.parse(capture.observedAt) > Date.parse(held.attempt.endedAt!)) {
    throw new Error("HELD_DETAIL_CAPTURE_BINDING_REFUSED");
  }
  return capture;
}
