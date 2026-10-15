import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { requireBallotState, type BallotState } from "./state-scopes.ts";
import { civicDataReadNotInitialized, promotedVersionOrThrow, readPromotedCivicData,
  type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { votingSitesContract } from "./voting-sites-data-plane.ts";
import type { VotingSitesFile } from "./voting-sites.ts";

const fallback = new Map<BallotState, CivicDataReadResult<VotingSitesFile>>();
const requests = new WeakMap<object, typeof fallback>();
function states(): typeof fallback {
  const edge = currentReaderAuthorityEdge();
  if (!edge) return fallback;
  let held = requests.get(edge);
  if (!held) { held = new Map(); requests.set(edge, held); }
  return held;
}

export async function readVotingSitesProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<VotingSitesFile>> {
  const key = requireBallotState(state), contract = votingSitesContract(key);
  const result = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, options);
  if (result.kind === "PROMOTED" && result.metadata.sourceId !== contract.sourceId) {
    throw new Error(`Voting-sites pointer names ${result.metadata.sourceId}, not ${contract.sourceId}.`);
  }
  states().delete(key);
  states().set(key, result);
  if (states().size > 8) states().delete(states().keys().next().value!);
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
