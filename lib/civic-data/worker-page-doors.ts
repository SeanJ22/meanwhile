import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { doorIdOfPage, finderOfRole, recordPublishedPages, type PageFinder } from "../doors/page-doors.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/** Does nothing unless the outcome put at least one fact live. Never throws: the publication already happened. */
export async function recordPublishedPageDoor(input: {
  readonly repos: Pick<ControlPlaneRepositories, "attempts" | "doors">;
  readonly page: WorkerPublicationCapture | null | undefined;
  readonly recordClass: string;
  readonly bodyId?: string | null;
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
      foundBy,
    }], input.now);
  } catch {
    /* the door record is written again by the next publication */
  }
}

export function withPageDoor<T extends { readonly status: string }>(outcome: T, page: WorkerPublicationCapture | null | undefined, recordClass: string): T & { readonly doorId?: string } {
  if (!page || outcome.status === "HELD") return outcome;
  const doorId = doorIdOfPage(recordClass, page.evidence.canonicalUrl);
  return doorId === null ? outcome : { ...outcome, doorId };
}
