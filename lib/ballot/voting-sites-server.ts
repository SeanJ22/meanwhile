import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../civic-data/state-reader.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { requireBallotState, stateBallotScope } from "../civic-data/state-scopes.ts";
import type { VotingSitesFile } from "./voting-sites.ts";
import { readPublishedSourceChecks } from "../civic-data/source-checks.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { votingSourceCheckOverlay } from "./voting-source-checks.ts";
import { recordVotingFailure } from "./voting-errors.ts";

export async function readVotingSitesProjection(state: string, options: PromotedCivicDataReadOptions = {}, deadlineMs?: number): Promise<CivicDataReadResult<VotingSitesFile>> {
  const startedAt = Date.now();
  const key = requireBallotState(state);
  const query = deadlineMs === undefined ? null : readerQuery(deadlineMs);
  const result = await (Object.keys(options).length
    ? readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", key), options)
    : (await readStateAuthorityProjection<VotingSitesFile>("voting-sites", key,
      query ? async (text, params) => (await query([{ text, params }]))[0] : undefined)).result);
  if (result.kind !== "PROMOTED" || result.value.sourceManifestVersion !== 1) return result;
  const keys = Object.keys(result.value.sourceHashes ?? {}), scope = stateBallotScope("voting-sites", key);
  const store = options.store as Partial<Pick<RoutineDataStore, "readSourceChecks">> | undefined;
  const confirmation = result.projection.latestConfirmation;
  const wholeCheckedAt = confirmation?.versionId === result.projection.versionId && confirmation.basis === "RAW_HASH_UNCHANGED"
    ? confirmation.retrieval.retrievedAt : undefined;
  let checks: Awaited<ReturnType<typeof readPublishedSourceChecks>> = [];
  try {
    if (store?.readSourceChecks) checks = await store.readSourceChecks("VOTING_SITE", scope, keys);
    else if (!Object.keys(options).length) {
      const selected = deadlineMs === undefined ? query ?? readerQuery() : readerQuery(Math.max(1, deadlineMs - (Date.now() - startedAt)));
      if (selected) checks = await readPublishedSourceChecks(async (text, params) => (await selected([{ text, params }]))[0] ?? [], "VOTING_SITE", scope, keys);
    }
  } catch (error) { recordVotingFailure({ stage: "source-check-reader", state: key }, error); }
  return { ...result, value: votingSourceCheckOverlay(result.value, checks, wholeCheckedAt) };
}
