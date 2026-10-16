import { AsyncLocalStorage } from "node:async_hooks";
import { currentReaderSelection } from "../db/reader-route.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { requireBallotState, type BallotState } from "./state-scopes.ts";
import { civicDataReadNotInitialized, promotedVersionOrThrow, readPromotedCivicData,
  type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { votingSitesContract } from "./voting-sites-data-plane.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

type VotingReads = Map<BallotState, CivicDataReadResult<VotingSitesFile>>;
const requests = new WeakMap<object, VotingReads>();
const localReads = new AsyncLocalStorage<VotingReads>();
function states(): VotingReads {
  const edge = currentReaderAuthorityEdge() ?? currentReaderSelection();
  let held = edge ? requests.get(edge) : localReads.getStore();
  if (!held) {
    held = new Map();
    if (edge) requests.set(edge, held); else localReads.enterWith(held);
  }
  return held;
}

export async function readVotingSitesProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<VotingSitesFile>> {
  const key = requireBallotState(state), contract = votingSitesContract(key), cache = states();
  const result = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, options);
  if (result.kind === "PROMOTED" && result.metadata.sourceId !== contract.sourceId) {
    throw new Error(`Voting-sites pointer names ${result.metadata.sourceId}, not ${contract.sourceId}.`);
  }
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return result;
}

export async function refreshVotingSitesFromPromoted(state: string, options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  return promotedVersionOrThrow(await readVotingSitesProjection(state, options));
}

export function votingSitesReadState(state: string): CivicDataReadResult<VotingSitesFile> {
  const contract = votingSitesContract(state);
  return states().get(requireBallotState(state)) ?? civicDataReadNotInitialized(contract.recordClass, contract.scope, "The state's voting sites have not been read.");
}

export function loadVotingSites(state: string): VotingSitesFile {
  const result = votingSitesReadState(state);
  if (result.kind === "PROMOTED") return result.value;
  throw new Error(`Voting-sites holding is ${result.kind}; refresh the state's projection before reading it.`);
}

export function resetVotingSitesCache(): void { states().clear(); }
