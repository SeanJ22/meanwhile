/**
 * Deterministic identity and idempotency fingerprints for the control plane.
 *
 * Every id here is a FUNCTION OF ITS INPUTS, never a counter and never a
 * random value. That is not tidiness. Two consequences depend on it:
 *
 *   1. IDEMPOTENCY. Two workers that independently decide the same route must
 *      be walked for the same obligation compute the same `RouteTask` id, so
 *      the second one collides with the first instead of creating a duplicate
 *      side effect. The architecture calls this "idempotent work fingerprints";
 *      it only works if the fingerprint is derived, not assigned.
 *
 *   2. REPLAY. The reproducibility gate re-runs the same immutable inputs and
 *      compares canonical identities. A random id fails that comparison for a
 *      reason that has nothing to do with truth, which trains everyone to
 *      ignore the gate.
 *
 * `Attempt` ids are the deliberate exception: an Attempt is a distinct physical
 * execution, and two attempts against one RouteTask MUST be distinguishable.
 * Its id therefore folds in the claim moment supplied by the caller — still a
 * pure function of its inputs, still replayable, never `Date.now()` reached for
 * inside a library.
 */

import { createHash } from "node:crypto";

/** A short, stable, collision-resistant digest of an ordered field list. */
export function fingerprint(parts: readonly (string | number | null | undefined)[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    // The unit separator cannot appear in the values we hash, so it is a safe
    // delimiter. Without one, ["ab","c"] and ["a","bc"] hash identically and
    // two different obligations silently become one.
    h.update(p === null || p === undefined ? "\u0000" : String(p));
    h.update("\u001f");
  }
  return h.digest("hex").slice(0, 24);
}

export function workItemId(project: string, subject: string, obligation: string): string {
  return `wi-${fingerprint([project, subject, obligation])}`;
}

export function routeTaskId(workItem: string, routeId: string, target: string): string {
  return `rt-${fingerprint([workItem, routeId, target])}`;
}

export function attemptId(routeTask: string, claimedAt: string, workerRef: string): string {
  return `at-${fingerprint([routeTask, claimedAt, workerRef])}`;
}

export function leaseId(routeTask: string, claimedAt: string, holder: string): string {
  return `ls-${fingerprint([routeTask, claimedAt, holder])}`;
}

/** Content address for an artifact. The vault key is derived from this. */
export function contentHash(bytes: Uint8Array | string): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}
