import { pathToFileURL } from "node:url";
import { acquireLegiscanVotes, legiscanDatasetListUrl } from "../lib/sources/legiscan/vote-acquisition.ts";
import { digest, legiscanState, type LegiscanIdentityAuthority } from "../lib/sources/legiscan/dataset.ts";
import { legiscanVotesCandidate, legiscanVotesContract, mergeLegiscanVotes, readLegiscanVotesProjection } from "../lib/sources/legiscan/votes.ts";
import { readOpenStatesPeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** A weekly check republishes changed facts and confirms the same pointer when nothing changed. */
export async function refreshLegiscanVotes(input: Omit<Parameters<typeof acquireLegiscanVotes>[0], "holders"> & { civicStore: RoutineDataStore }) {
  const state = legiscanState(input.state), now = input.now?.() ?? new Date().toISOString();
  const roster = await readOpenStatesPeopleProjection(`US-${state}`, { store: input.civicStore, now, bypassCache: true });
  if (roster.kind !== "PROMOTED" || !roster.metadata.versionId) throw new Error("LEGISCAN_OPENSTATES_IDENTITY_UNAVAILABLE");
  const prior = await readLegiscanVotesProjection(state, { store: input.civicStore, now, bypassCache: true });
  if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("LEGISCAN_VOTES_PREDECESSOR_UNAVAILABLE");
  let projection = prior.kind === "PROMOTED" ? prior.value : null, baseVersionId = prior.metadata.versionId;
  let publication: { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome } | null = null;
  const authority: LegiscanIdentityAuthority = { sourceId: "plural-openstates", scope: roster.metadata.scope, versionId: roster.metadata.versionId, crosswalkSha256: digest([]), joins: [] };
  const publish = async (candidate: ReturnType<typeof legiscanVotesCandidate>) => {
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, legiscanVotesContract(state), candidate, input.now?.() ?? now, baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`LEGISCAN_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    projection = candidate.readModel as NonNullable<typeof projection>;
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
  };
  const acquisition = await acquireLegiscanVotes({ ...input, holders: roster.value.roster.officeholders, onDataset: async result => {
    const joins = result.joins;
    const next = mergeLegiscanVotes(projection, { state, votes: result.votes, datasets: [{ state, sessionId: result.session.sessionId,
      sessionName: result.session.sessionName, datasetHash: result.session.datasetHash, datasetDate: result.session.datasetDate, downloadedAt: result.evidence.retrievedAt }],
      identityAuthority: { ...authority, joins, crosswalkSha256: digest(joins) } });
    if (!projection || digest(next) !== digest(projection)) await publish(legiscanVotesCandidate({ projection: next, acquired: [result.evidence], held: result.held, checkedAt: input.now?.() ?? now }));
    await input.onDataset?.(result);
  } });
  if (!acquisition.results.length && acquisition.held.some(row => row.key.startsWith("session:"))) throw new Error("LEGISCAN_DATASETS_UNAVAILABLE");
  // The listing's current source observation confirms even an empty, unchanged source check.
  const next = projection ?? mergeLegiscanVotes(null, { state, votes: [], datasets: [], identityAuthority: authority });
  await publish(legiscanVotesCandidate({ projection: next, acquired: [acquisition.listing, ...acquisition.results.map(result => result.evidence)], held: acquisition.held, checkedAt: input.now?.() ?? now }));
  return { publication: publication as unknown as { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome }, held: acquisition.held,
    state, rollCalls: next.rollCalls.length, positions: next.rollCalls.reduce((sum, vote) => sum + vote.positions.length, 0) };
}
async function main() {
  const args = process.argv.slice(2), stateArgument = args.find(arg => arg.startsWith("--state="));
  if (args.length !== 2 || !args.includes("--promote") || !stateArgument) throw new Error("LEGISCAN_VOTES_ARGUMENTS_REQUIRED");
  const state = legiscanState(stateArgument.slice("--state=".length));
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const civicStore = new PostgresRoutineDataStore();
  let refreshed: Awaited<ReturnType<typeof refreshLegiscanVotes>>;
  try {
    refreshed = await withPublisherAcquisitionDeadline(`LegiScan ${state} votes`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refreshLegiscanVotes({ signal, state, civicStore }));
  } catch (error) {
    const failure = sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: civicStore, contractId: legiscanVotesContract(state), requestedUrl: legiscanDatasetListUrl(state), failure });
    console.log(failed.line); process.exitCode = 2; return;
  }
  printSourceRunnerReceipt(legiscanVotesContract(state), refreshed.publication.candidate, refreshed.publication.outcome);
  console.log(`${state}: ${refreshed.rollCalls} roll calls; ${refreshed.positions} member positions; ${refreshed.held.length} held records.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
