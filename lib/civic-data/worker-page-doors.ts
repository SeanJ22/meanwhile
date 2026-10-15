import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { doorIdOfPage, pageAddress, namesOfDivision, finderOfRole, recordPublishedPages, type PageFinder } from "../doors/page-doors.ts";
import { classifySourceContent, SOURCE_FAMILIES } from "../doors/source-content.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/** Does nothing unless the outcome put at least one fact live. Never throws: the publication already happened. */
export async function recordPublishedPageDoor(input: {
  readonly repos: Pick<ControlPlaneRepositories, "attempts" | "doors">;
  readonly page: WorkerPublicationCapture | null | undefined;
  readonly recordClass: string;
  readonly bodyId?: string | null;
  readonly ocdId?: string | null;
  readonly workItemId?: string | null;
  readonly published: number;
  readonly now: string;
}): Promise<void> {
  if (!input.page || input.published <= 0) return;
  try {
    let foundBy: PageFinder | null = null;
    try {
      const attempt = await input.repos.attempts.read(input.page.evidence.acquiredByAttemptId);
      foundBy = attempt ? finderOfRole(attempt.value.worker.role) : null;
    } catch {
      foundBy = null;
    }
    await recordPublishedPages(input.repos.doors, [{
      url: input.page.evidence.canonicalUrl,
      retrievedAt: input.page.observedAt,
      recordClass: input.recordClass,
      bodyId: input.bodyId ?? null,
      ocdId: input.ocdId ?? null,
      workItemId: input.workItemId ?? null,
      foundBy,
      content: { text: input.page.evidence.text, contentType: "", names: namesOfDivision(input.ocdId ?? input.bodyId), belongsToPlace: true },
    }], input.now);
  } catch {
    /* the door record is written again by the next publication */
  }
}

export async function withPageDoor<T extends { readonly status: string }>(repos: Pick<ControlPlaneRepositories, "doors">, outcome: T, page: WorkerPublicationCapture | null | undefined, recordClass: string): Promise<T & { readonly doorId?: string; readonly sourceObservedAt?: string; readonly sourceArtifactId?: string }> {
  if (!page || outcome.status === "HELD") return outcome;
  const publishing = classifySourceContent({ url: page.evidence.canonicalUrl, text: page.evidence.text,
    contentType: "", names: [], belongsToPlace: true, owed: SOURCE_FAMILIES }).kind === "DOOR";
  const url = pageAddress(page.evidence.canonicalUrl)?.url;
  const matches = url ? await repos.doors.listWhere(["config", "url"], url) : [];
  const existing = matches.find(row => row.value.status !== "SUSPENDED") ?? matches[0];
  const doorId = publishing ? existing?.id ?? doorIdOfPage(recordClass, page.evidence.canonicalUrl) : null;
  return { ...outcome, ...(doorId === null ? {} : { doorId }), sourceObservedAt: page.observedAt, sourceArtifactId: page.evidence.artifactId };
}
