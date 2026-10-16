import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import type { BillSummariesFile } from "./bill-summaries.ts";
import {
  FEDERAL_ROLLCALL_SCOPE,
  type FederalRollCallsReadModel,
} from "./data-plane.ts";
import { partyVotersByVote, type PartyVoters } from "./party-breakdown.ts";
import type { RollCallVote, VotesSnapshot } from "./types.ts";
import { readPromotedEdgeFirst } from "../registry/runtime-edge.ts";

let cache: FederalRollCallsReadModel | null = null;
let readState: CivicDataReadResult<FederalRollCallsReadModel> = civicDataReadNotInitialized(
  "FEDERAL_ROLL_CALL",
  FEDERAL_ROLLCALL_SCOPE,
  "The federal roll-call canonical pointer has not been read for this process.",
);

function validateProjection(value: FederalRollCallsReadModel, versionId: string): void {
  if (
    value.formatVersion !== 1 ||
    value.snapshot?.congress <= 0 ||
    value.snapshot?.session <= 0 ||
    !Array.isArray(value.snapshot?.votes) ||
    !Array.isArray(value.snapshot?.positions) ||
    !value.billSummaries ||
    typeof value.billSummaries.summaries !== "object" ||
    !Array.isArray(value.billSummaries.pending)
  ) {
    throw new Error(`Federal roll-call projection ${versionId} does not satisfy the Reader contract.`);
  }
}

/** The promoted bill summaries carried into a new roll-call acquisition. */
export function billSummariesForRollCallAcquisition(
  current: CivicDataReadResult<FederalRollCallsReadModel>,
): BillSummariesFile {
  if (current.kind === "PROMOTED" || current.kind === "BOOTSTRAP") {
    return current.value.billSummaries;
  }
  if (current.kind === "NOT_RECORDED") throw new Error(current.detail);
  throw new CivicDataStoreUnavailableError(current);
}

export async function readFederalRollCallsProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<FederalRollCallsReadModel>> {
  const result = await readPromotedCivicData<FederalRollCallsReadModel>("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE, options);
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validateProjection(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshFederalVotesFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const result = await readFederalRollCallsProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/** The federal roll-call preload: the reader edge's proven copy, else the database. */
export const settleFederalVotesRead = (): Promise<string | null> =>
  readPromotedEdgeFirst("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE, refreshFederalVotesFromPromoted, "The federal roll calls");

export function federalRollCallsReadState(): CivicDataReadResult<FederalRollCallsReadModel> {
  return readState;
}

export function getFederalVotesReadModel(): FederalRollCallsReadModel {
  if (!cache) throw new Error(`Federal roll calls are ${readState.kind}; call readFederalRollCallsProjection before using the synchronous projection.`);
  return cache;
}

export function getVotesSnapshot(): Omit<VotesSnapshot,"votes"> & {votes: (RollCallVote & {readerPartyVoters: PartyVoters})[]} {
  const snapshot = getFederalVotesReadModel().snapshot;
  const groups = partyVotersByVote(snapshot.positions);
  return {...snapshot,votes:snapshot.votes.map(vote => ({...vote,
    readerPartyVoters:(vote as RollCallVote & {readerPartyVoters?: PartyVoters}).readerPartyVoters ?? groups.get(vote.id) ?? {yes:[],no:[]},
  }))};
}

export function getVoteIds(): Set<string> {
  const ids = new Set(getVotesSnapshot().votes.map((vote) => vote.id));
  if (ids.size === 0) throw new Error("Federal vote target set is empty — refusing to validate against nothing.");
  return ids;
}
