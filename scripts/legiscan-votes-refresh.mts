import { pathToFileURL } from "node:url";
import { acquireLegiscanVotes, legiscanDatasetListUrl } from "../lib/sources/legiscan/vote-acquisition.ts";
import { digest, legiscanState, type LegiscanIdentityAuthority } from "../lib/sources/legiscan/dataset.ts";
import { legiscanVotesCandidate, legiscanVotesContract, legiscanVotesScope, mergeLegiscanVoteMetadata, readLegiscanVotesProjection } from "../lib/sources/legiscan/votes.ts";
import { readOpenStatesPeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { bindVotePageVault } from "../lib/state-rollcalls/vote-pages.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { createVoteRefreshSink } from "../lib/state-rollcalls/vote-predecessor.ts";
import { processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** Current session datasets stream through the existing registered publication. */
export async function refreshLegiscanVotes(input: Omit<Parameters<typeof acquireLegiscanVotes>[0], "holders"> & { civicStore: RoutineDataStore; vault?: EvidenceStore }) {
  const started = performance.now(), before = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
    controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
  const state = legiscanState(input.state), now = input.now?.() ?? new Date().toISOString();
  const roster = await readOpenStatesPeopleProjection(`US-${state}`, { store: input.civicStore, now, bypassCache: true });
  if (roster.kind !== "PROMOTED" || !roster.metadata.versionId) throw new Error("LEGISCAN_OPENSTATES_IDENTITY_UNAVAILABLE");
  const vault = input.vault ?? input.store ?? rawCaptureVault();
  const initialized = await createVoteRefreshSink({ state, sourceId: "legiscan", scope: legiscanVotesScope(state), civicStore: input.civicStore,
    vault, signal: input.signal, readPrior: () => readLegiscanVotesProjection(state, { store: input.civicStore, now, bypassCache: true }) });
  const sink = initialized.sink;
  let baseVersionId = initialized.baseVersionId;
  let projection = initialized.priorMetadata;
  bindVotePageVault(input.civicStore, vault);
  let publication: { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome } | null = null;
  const authority: LegiscanIdentityAuthority = { sourceId: "plural-openstates", scope: roster.metadata.scope, versionId: roster.metadata.versionId, crosswalkSha256: digest([]), joins: [] };
  const publish = async (candidate: ReturnType<typeof legiscanVotesCandidate>) => {
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, legiscanVotesContract(state), candidate, input.now?.() ?? now, baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`LEGISCAN_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    projection = { ...candidate.readModel as NonNullable<typeof projection>, rollCalls: [] };
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
  };
  const identityHeld: { key: string; detail: string }[] = [];
  try {
    const acquisition = await acquireLegiscanVotes({ ...input, holders: roster.value.roster.officeholders,
      onVote: async vote => {
        const issue = await sink.put(vote);
        if (issue) identityHeld.push({ key: vote.id, detail: issue });
        await input.onVote?.(vote);
      }, onDataset: async result => {
        const joins = result.joins;
        const next = { ...mergeLegiscanVoteMetadata(projection, { state, datasets: [{ state, sessionId: result.session.sessionId,
          sessionName: result.session.sessionName, datasetHash: result.session.datasetHash, datasetDate: result.session.datasetDate, downloadedAt: result.evidence.retrievedAt }],
          identityAuthority: { ...authority, joins, crosswalkSha256: digest(joins) } }), ...await sink.snapshot() };
        await publish(legiscanVotesCandidate({ projection: next, acquired: [result.evidence], held: [...result.held,...identityHeld], checkedAt: input.now?.() ?? now }));
        await input.onDataset?.(result);
      } });
    if (!acquisition.completed.length && acquisition.held.some(row => row.key.startsWith("session:"))) throw new Error("LEGISCAN_DATASETS_UNAVAILABLE");
    const next = { ...mergeLegiscanVoteMetadata(projection, { state, datasets: [], identityAuthority: authority }), ...await sink.snapshot() };
    await publish(legiscanVotesCandidate({ projection: next, acquired: [acquisition.listing, ...acquisition.completed.map(result => result.evidence)], held: [...acquisition.held,...identityHeld], checkedAt: input.now?.() ?? now }));
    const after = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
      controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
    const readerDatabaseBytes = after.reader - before.reader, controlPlaneDatabaseBytes = after.controlPlane - before.controlPlane;
    return { publication: publication as unknown as { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome }, held: [...acquisition.held,...identityHeld],
      state, rollCalls: next.rollCalls.length, positions: next.rollCalls.reduce((sum,vote) => sum + (vote.positionCount ?? vote.positions.length), 0),
      resources: { peakRssBytes: process.resourceUsage().maxRSS * 1024, runtimeMs: performance.now() - started,
        readerDatabaseBytes, controlPlaneDatabaseBytes, databaseBytes: readerDatabaseBytes + controlPlaneDatabaseBytes } };
  } finally { await sink.close(); }
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
  console.log(JSON.stringify(refreshed.resources));
  console.log(`${state}: ${refreshed.rollCalls} roll calls; ${refreshed.positions} member positions; ${refreshed.held.length} held records.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
