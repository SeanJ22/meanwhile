/**
 * **ONE READER FOR THE HEALTH STORES.** (A.1, 2026-08-30. RULING 103.)
 *
 * `reader-suite.mts` had `loadCorpus` and `control-set.mts` had `loadKey`, and
 * they were the same eleven lines twice: exists → read → parse → refuse a
 * non-array → return. `pnpm dupes` names the pair, and it is right to: the
 * interesting behaviour in those lines is a REFUSAL, and a refusal maintained
 * in two places is a refusal that will eventually only be maintained in one.
 *
 * The refusal itself is the point. A file that exists but is not an array is a
 * WALL, not an empty corpus — reading it as zero rows would make a malformed
 * store indistinguishable from an unloaded one, and the contracts treat those
 * as completely different states (`AWAITING_OWNER_DATA` against a failure).
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Read a committed JSON array store, or `null` when the file is absent.
 *
 * `null` means NOT THERE. `[]` means there and empty. A caller that collapses
 * the two has thrown away the distinction the health contracts are built on.
 * A file that exists and is not an array throws, naming the path and what was
 * expected — "we could not read it" and "there is nothing there" are different
 * sentences and this returns different things for them.
 */
export function loadJsonArray<T>(path: string, what: string): T[] | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} exists but is not an array of ${what}`);
  }
  return parsed as T[];
}
