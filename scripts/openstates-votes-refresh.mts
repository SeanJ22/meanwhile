import { pathToFileURL } from "node:url";
import { acquireStateVotes, pluralJurisdictionUrl } from "../lib/sources/plural/vote-acquisition.ts";
import { holdPluralVoteEvidence, pluralVotesCandidate, pluralVotesContract, mergePluralVotes, readPluralVotesProjection, pluralVoteState, type PluralVoteAcquisition, type PluralVoteFact } from "../lib/sources/plural/votes.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** A run publishes once per session, and again within a session after this long, so a cut-off run keeps its progress. */
const VOTE_PUBLISH_SLICE_MS = 10 * 60_000;

/** Manual invocation and the standing source task share this sole writer. */
export async function refreshStateVotes(input: Parameters<typeof acquireStateVotes>[0] & { civicStore: RoutineDataStore; vault: EvidenceStore }) {
  const prior = await readPluralVotesProjection(input.state, { store: input.civicStore, bypassCache: true, now: input.now?.() });
  if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("PLURAL_VOTES_PREDECESSOR_UNAVAILABLE");
  let projection = prior.kind === "PROMOTED" ? prior.value : null;
  let baseVersionId = prior.metadata.versionId;
  let publication = null as { candidate: RoutineCandidate; outcome: PromotionOutcome } | null;
  const publish = async (votes: readonly PluralVoteFact[], acquired: readonly PluralVoteAcquisition[], held: readonly { key: string; detail: string }[]) => {
    const candidate = pluralVotesCandidate({ projection: mergePluralVotes(input.state, projection, votes), acquired, held, checkedAt: input.now?.() ?? new Date().toISOString() });
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, pluralVotesContract(input.state), candidate,
      input.now?.() ?? new Date().toISOString(), baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`PLURAL_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    projection = candidate.readModel as NonNullable<typeof projection>;
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
  };
  let batch = { session: null as string | null, since: 0, votes: [] as PluralVoteFact[], acquired: [] as PluralVoteAcquisition[], held: [] as { key: string; detail: string }[] };
  const flush = async () => {
    if (!batch.acquired.length) return;
    const { votes, acquired, held } = batch;
    batch = { session: null, since: 0, votes: [], acquired: [], held: [] };
    await publish(votes, acquired, held);
  };
  const acquisition = await acquireStateVotes({ ...input, onBill: async result => {
    const session = result.votes[0]?.session ?? batch.session;
    if (batch.acquired.length && (session !== batch.session || Date.now() - batch.since >= VOTE_PUBLISH_SLICE_MS)) await flush();
    if (!batch.acquired.length) batch.since = Date.now();
    batch.session = session; batch.votes.push(...result.votes); batch.held.push(...result.held);
    batch.acquired.push(await holdPluralVoteEvidence(input.vault, result.evidence));
    await input.onBill?.(result);
  } });
  await flush();
  if (!publication) {
    if (acquisition.held.length) throw new Error(`PLURAL_VOTES_ACQUISITION_INCOMPLETE:${acquisition.held.map(row => row.detail).join(";")}`);
    await publish([], await Promise.all(acquisition.acquisitions.map(row => holdPluralVoteEvidence(input.vault, row))), []);
  }
  return { publication: publication!, held: acquisition.held };
}

async function main() {
  const args = process.argv.slice(2), stateArg = args.find(arg => arg.startsWith("--state="));
  if (args.length !== 2 || !args.includes("--promote") || !stateArg) throw new Error("STATE_VOTES_PROMOTION_AND_STATE_REQUIRED");
  const state = pluralVoteState(stateArg.slice("--state=".length));
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const civicStore = new PostgresRoutineDataStore(), vault = rawCaptureVault();
  let refreshed: Awaited<ReturnType<typeof refreshStateVotes>>;
  try {
    refreshed = await withPublisherAcquisitionDeadline(`Open States ${state.toUpperCase()} votes`, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refreshStateVotes({ state, signal, civicStore, vault }));
  } catch (error) {
    const failure = sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: civicStore, contractId: pluralVotesContract(state), requestedUrl: pluralJurisdictionUrl(state), failure });
    console.log(failed.line); process.exitCode = 2; return;
  }
  const projection = refreshed.publication.candidate.readModel as import("../lib/sources/plural/votes.ts").PluralVotesProjection;
  console.log(JSON.stringify({ state: state.toUpperCase(), rollCalls: projection.rollCalls.length,
    memberPositions: projection.rollCalls.reduce((sum, vote) => sum + vote.positions.length, 0),
    heldFacts: refreshed.held.length, unchanged: Boolean(refreshed.publication.outcome.confirmed) }));
  printSourceRunnerReceipt(pluralVotesContract(state), refreshed.publication.candidate, refreshed.publication.outcome);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
