/**
 * DB-54: the call the worker publishers make after a fact from a saved page
 * goes live. Kept apart from the publishers so they add one line each.
 */

import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { finderOfRole, recordPublishedPages, type PageFinder } from "../doors/page-doors.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";

/**
 * Registers the page behind a published fact as a door. Does nothing unless
 * the outcome put at least one fact live, so a held reading adds no door.
 * Never throws: the publication already happened.
 */
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
