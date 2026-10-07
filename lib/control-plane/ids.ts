/** Every id here is a deterministic function of its inputs, never a counter or random, so independent workers collide instead of duplicating. */

import { createHash } from "node:crypto";

export function fingerprint(parts: readonly (string | number | null | undefined)[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    // The unit separator cannot appear in hashed values; without a delimiter ["ab","c"] and ["a","bc"] would collide.
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
