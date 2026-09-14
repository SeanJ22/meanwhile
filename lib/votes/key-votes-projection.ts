import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  FEDERAL_KEY_VOTE_SCOPE,
  FEDERAL_VOTES_SOURCE_ID,
  type FederalKeyVotePositions,
  type FederalKeyVotesReadModel,
  type FederalKeyVotesSnapshot,
} from "./data-plane.ts";
import { KEY_VOTES_CRITERIA } from "./key-votes.ts";
import { federalKeyVoteSelectionV1Issue, hydrateFederalKeyVoteBootstrapV1 } from "./key-vote-selection-v1.ts";

let cache: FederalKeyVotesReadModel | null = null;
let readState: CivicDataReadResult<FederalKeyVotesReadModel> = civicDataReadNotInitialized(
  "FEDERAL_KEY_VOTE",
  FEDERAL_KEY_VOTE_SCOPE,
  "The federal key-vote canonical pointer has not been read for this process.",
);

function refKey(entryId: string, chamber: "house" | "senate", ref: { congress: number; session: number; rollNumber: number }): string {
  return `${entryId}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
}

function validateProjection(value: FederalKeyVotesReadModel, versionId: string): void {
  if (
    value.formatVersion !== 1 ||
    value.selectionVersion !== "v1" ||
    value.snapshot?.formatVersion !== 1 ||
    value.positions?.formatVersion !== 1 ||
    value.snapshot.criteria !== KEY_VOTES_CRITERIA ||
    !Array.isArray(value.snapshot.entries) ||
    typeof value.positions.positions !== "object"
  ) {
    throw new Error(`Federal key-vote projection ${versionId} does not satisfy selection v1.`);
  }
  const selectionIssue = federalKeyVoteSelectionV1Issue(value.snapshot);
  if (selectionIssue) throw new Error(`Federal key-vote projection ${versionId}: ${selectionIssue}.`);
  const selected = new Set(value.snapshot.entries.flatMap((entry) => [
    ...entry.house.map((ref) => refKey(entry.id, "house", ref)),
    ...entry.senate.map((ref) => refKey(entry.id, "senate", ref)),
  ]));
  if ([...selected].some((key) => value.positions.positions[key] === undefined)) {
    throw new Error(`Federal key-vote projection ${versionId} is missing a selected roll position map.`);
  }
  if (Object.keys(value.positions.positions).some((key) => !selected.has(key))) {
    throw new Error(`Federal key-vote projection ${versionId} contains a position map outside selection v1.`);
  }
}

/** Exact reviewed-v1 payload and provenance for one explicit durable first-seed import. */
export function federalKeyVotesFirstSeed(): CivicDataBootstrap<FederalKeyVotesReadModel> {
  const tracked = JSON.parse(readFileSync(join(process.cwd(), "data", "votes", "key-votes-snapshot.json"), "utf8")) as FederalKeyVotesSnapshot;
  const snapshot = hydrateFederalKeyVoteBootstrapV1(tracked);
  const positions = JSON.parse(readFileSync(join(process.cwd(), "data", "votes", "key-vote-positions.json"), "utf8")) as FederalKeyVotePositions;
  const value: FederalKeyVotesReadModel = { formatVersion: 1, selectionVersion: "v1", snapshot, positions };
  validateProjection(value, "bundled first seed");
  return {
    value,
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    version: "v1",
    versionId: `bootstrap:FEDERAL_KEY_VOTE:v1:${positions.fetchedAt}`,
    sourceThrough: positions.fetchedAt,
    retrievedAt: positions.fetchedAt,
    detail: "The canonical key-vote store answered with no pointer; serving the reviewed v1 first-seed projection explicitly.",
  };
}

/** A configured store failure never opens the tracked first-seed files. */
export async function readFederalKeyVotesProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalKeyVotesReadModel>> {
  const result = await readPromotedOrBootstrap({
    ...options,
    recordClass: "FEDERAL_KEY_VOTE",
    scope: FEDERAL_KEY_VOTE_SCOPE,
    bootstrap: federalKeyVotesFirstSeed,
    allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateProjection(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshFederalKeyVotesFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const result = await readFederalKeyVotesProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

export function federalKeyVotesReadState(): CivicDataReadResult<FederalKeyVotesReadModel> {
  return readState;
}

export function getFederalKeyVotesReadModel(): FederalKeyVotesReadModel {
  if (!cache) throw new Error(`Federal key votes are ${readState.kind}; call readFederalKeyVotesProjection before using the synchronous projection.`);
  return cache;
}
