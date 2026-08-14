import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { VotesSnapshot } from "./types.ts";

/**
 * The committed roll-call snapshot, read once per process — never a live
 * fetch against the chambers. Shared by /api/votes (rendering) and
 * /api/reactions (validating that a reaction's target is a vote that
 * actually exists — an invented target id must not become a storable row).
 */

let cache: VotesSnapshot | null = null;

/** Throws if the snapshot is missing — callers choose their honest fallback. */
export function getVotesSnapshot(): VotesSnapshot {
  cache ??= JSON.parse(
    readFileSync(join(process.cwd(), "data", "votes", "votes-snapshot.json"), "utf8"),
  ) as VotesSnapshot;
  return cache;
}

let idCache: Set<string> | null = null;

/** Roll-call ids present in the snapshot — the valid reaction targets. */
export function getVoteIds(): Set<string> {
  idCache ??= new Set(getVotesSnapshot().votes.map((v) => v.id));
  return idCache;
}
