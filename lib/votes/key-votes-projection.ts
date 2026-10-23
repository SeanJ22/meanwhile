import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  FEDERAL_KEY_VOTE_SCOPE,
  type FederalKeyVotesReadModel,
} from "./data-plane.ts";
import { KEY_VOTES_CRITERIA } from "./key-votes.ts";
import { federalKeyVoteSelectionV1Issue } from "./key-vote-selection-v1.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";
import { currentReaderSelection, type ReaderSelection } from "../db/reader-route.ts";

const requestReads = new WeakMap<ReaderSelection, CivicDataReadResult<FederalKeyVotesReadModel>>();
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

export async function readFederalKeyVotesProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalKeyVotesReadModel>> {
  const result = await readPromotedCivicData<FederalKeyVotesReadModel>("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE, options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateProjection(result.value, result.metadata.versionId ?? result.kind);
  }
  const selected = currentReaderSelection();
  if (selected) requestReads.set(selected, result);
  else readState = result;
  return result;
}

export async function refreshFederalKeyVotesFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const result = await readFederalKeyVotesProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/** The key-vote preload: the reader edge's proven copy, else the database. */
export const settleFederalKeyVotesRead = (): Promise<string | null> =>
  readPromotedEdgeFirst("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE, refreshFederalKeyVotesFromPromoted, "The federal key votes");

export function federalKeyVotesReadState(): CivicDataReadResult<FederalKeyVotesReadModel> {
  const selected = currentReaderSelection();
  return selected ? requestReads.get(selected) ?? civicDataReadNotInitialized("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE,
    "This request's key-vote records have not been read.") : readState;
}

export function getFederalKeyVotesReadModel(): FederalKeyVotesReadModel {
  const held = federalKeyVotesReadState();
  if (held.kind !== "PROMOTED" && held.kind !== "BOOTSTRAP") throw new Error(`Federal key votes are ${held.kind}; call readFederalKeyVotesProjection before using the synchronous projection.`);
  return held.value;
}
