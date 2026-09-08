import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { StateVotesSnapshot } from "./types.ts";
import { promotedReadModel } from "../../civic-data/read-model.ts";

/**
 * State-legislature roll calls, read once per process.
 *
 * Same architecture as `lib/votes/snapshot.ts` and for the same reason: the
 * Reader requests never fetch a publisher. A validated official promotion is
 * read from the operational store; the committed LegiScan projection is only
 * the bootstrap last-known-good value while no promotion exists.
 */

let cache: StateVotesSnapshot | null = null;

/** Runtime read of official promoted state roll calls; file remains bootstrap LKG. */
export async function refreshStateVotesFromPromoted(scope = "supported-states"): Promise<string | null> {
  const scopes = scope === "supported-states" ? ["supported-states", "US-AZ", "US-NH", "US-NJ"] : [scope];
  const promotions = (await Promise.all(scopes.map((item) => promotedReadModel<StateVotesSnapshot>("STATE_ROLL_CALL", item))))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (promotions.length === 0) return null;
  let payload = structuredClone(getStateVotesSnapshot());
  for (const promoted of promotions) {
    const next = promoted.payload;
    if (!Array.isArray(next.rollCalls) || !Array.isArray(next.positions) || !Array.isArray(next.datasets)) {
      throw new Error(`Promoted state-vote projection ${promoted.versionId} does not satisfy StateVotesSnapshot.`);
    }
    if (promoted.scope === "supported-states") {
      payload = structuredClone(next);
      continue;
    }
    const state = promoted.scope.slice(-2);
    const oldRollIds = new Set(payload.rollCalls.filter((roll) => roll.state === state).map((roll) => roll.id));
    payload.rollCalls = [...payload.rollCalls.filter((roll) => roll.state !== state), ...next.rollCalls];
    payload.positions = [...payload.positions.filter((position) => !oldRollIds.has(position.rollCallId)), ...next.positions];
    payload.datasets = [...payload.datasets.filter((dataset) => dataset.state !== state), ...next.datasets];
    payload.identifierMatch.byState[state] = next.identifierMatch.byState[state];
  }
  const matchRows = Object.values(payload.identifierMatch.byState);
  payload.identifierMatch.peopleSeen = matchRows.reduce((sum, row) => sum + row.peopleSeen, 0);
  payload.identifierMatch.peopleMatched = matchRows.reduce((sum, row) => sum + row.peopleMatched, 0);
  payload.identifierMatch.distinctOfficeholders = new Set(payload.positions.map((position) => position.officeholderId)).size;
  cache = payload;
  idCache = null;
  return promotions.map((item) => item.versionId).join(",");
}

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
