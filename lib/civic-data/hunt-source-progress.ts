import { contentHash } from "../control-plane/ids.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type HuntSourceProgress, type OwnerDigestRecord } from "../control-plane/owner-surface.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";

/** A stage is repeatable within a cycle: admitted QUEUED, then memory-deferred
 * QUEUED, are distinct observations. Bind the id to the immutable event bytes
 * so both survive while replaying the same event remains idempotent.
 */
export function huntSourceProgressDigest(cycleId: string, testedSha: string | null, progress: HuntSourceProgress): OwnerDigestRecord {
  const digestId = `${cycleId}:${progress.taskId}:${progress.stage}:${contentHash(canonicalJson({ testedSha, progress }))}`;
  return { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId, writtenAt: progress.at,
    headline: `${progress.taskId}: ${progress.stage}`, lines: [progress.detail], cycleOk: null,
    testedSha, huntSourceProgress: progress };
}
