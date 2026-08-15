import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StateVotesSnapshot } from "./types.ts";

/**
 * The committed state-legislature roll-call snapshot, read once per process.
 *
 * Same architecture as `lib/votes/snapshot.ts` and for the same reason: the
 * app never fetches LegiScan per page load. `pnpm legiscan:fetch` refreshes
 * the file, and only when `dataset_hash` says something changed.
 */

let cache: StateVotesSnapshot | null = null;

/** Throws if the snapshot is missing — callers choose their honest fallback. */
export function getStateVotesSnapshot(): StateVotesSnapshot {
  cache ??= JSON.parse(
    readFileSync(
      join(process.cwd(), "data", "votes", "state-votes-snapshot.json"),
      "utf8",
    ),
  ) as StateVotesSnapshot;
  return cache;
}

let idCache: Set<string> | null = null;

/**
 * Roll-call ids present in the snapshot — the valid reaction targets.
 *
 * Same contract as the federal `getVoteIds()`: an invented target id must
 * not become a storable row.
 */
export function getStateVoteIds(): Set<string> {
  idCache ??= new Set(getStateVotesSnapshot().rollCalls.map((r) => r.id));
  return idCache;
}
