import { pathToFileURL } from "node:url";
import { acquireStateVotes, pluralJurisdictionUrl, type PluralVoteProgress } from "../lib/sources/plural/vote-acquisition.ts";
import { holdPluralVoteEvidence, pluralVotesCandidate, pluralVotesContract, pluralVotesScope, readPluralVotesProjection, pluralVoteState, type PluralVoteAcquisition } from "../lib/sources/plural/votes.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { bindVotePageVault } from "../lib/state-rollcalls/vote-pages.ts";
import { createVoteRefreshSink } from "../lib/state-rollcalls/vote-predecessor.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** Manual invocation and the standing source task share this sole writer. */
export async function refreshStateVotes(input: Parameters<typeof acquireStateVotes>[0] & { civicStore: RoutineDataStore; vault: EvidenceStore; cache?: CivicReadCache }) {
  const started = performance.now();
  const before = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
    controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
  const initialized = await createVoteRefreshSink({ state: pluralVoteState(input.state).toUpperCase(), sourceId: "plural-openstates-votes",
    scope: pluralVotesScope(input.state), civicStore: input.civicStore, vault: input.vault, signal: input.signal, cache: input.cache,
    readPrior: () => readPluralVotesProjection(input.state, { store: input.civicStore,  now: input.now?.() }) });
  const sink = initialized.sink;
  const copies = (input.cache ?? runtimeCivicReadCache()).jobState(), progressKey = pluralVotesScope(input.state);
  let progress: PluralVoteProgress = input.resume ?? await copies.readCheckpoint<PluralVoteProgress>("openstates-vote-progress", progressKey) ?? {};
  let baseVersionId = initialized.baseVersionId;
  const priorAcquisitions = async () => baseVersionId ? await input.civicStore.readCandidatePath<PluralVoteAcquisition[]>(baseVersionId,["normalizedPayload","acquisitions"]) ?? [] : [];
  let acquisitions = await priorAcquisitions();
  const priorHeld = baseVersionId ? await input.civicStore.readCandidatePath<{ key: string; detail: string }[]>(baseVersionId,["normalizedPayload","held"]) ?? [] : [];
  bindVotePageVault(input.civicStore, input.vault);
  let publication = null as { candidate: RoutineCandidate; outcome: PromotionOutcome } | null;
  const identityHeld: { key: string; detail: string }[] = [];
  const publish = async (acquired: readonly PluralVoteAcquisition[], held: readonly { key: string; detail: string }[], checkpoints: PluralVoteProgress = {}) => {
    acquisitions = [...new Map([...acquisitions,...acquired].map(row=>[`${row.finalUrl}\n${row.sha256}`,row])).values()];
    const candidate = pluralVotesCandidate({ projection: await sink.snapshot(), acquired:acquisitions, held, checkedAt: input.now?.() ?? new Date().toISOString() });
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, pluralVotesContract(input.state), candidate,
      input.now?.() ?? new Date().toISOString(), baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`PLURAL_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
    progress = { ...progress, ...checkpoints };
    await copies.checkpoint("openstates-vote-progress", progressKey, progress);
  };
  try {
    const acquisition = await acquireStateVotes({ ...input, resume: progress, onCheckpoint: async checkpoints => {
      progress = { ...progress, ...checkpoints };
      await copies.checkpoint("openstates-vote-progress", progressKey, progress);
      await input.onCheckpoint?.(checkpoints);
    }, onBill: async result => {
      const held = [...result.held];
      for (const vote of result.votes) {
        const issue = await sink.put(vote);
        if (issue) { const detail = { key: vote.id, detail: issue }; held.push(detail); identityHeld.push(detail); }
      }
      // Publish and save the source position before requesting the next bounded batch.
      await publish([await holdPluralVoteEvidence(input.vault, result.evidence)],held,result.checkpoints);
      await input.onBill?.(result);
    } });
    const held = publication ? [...acquisition.held, ...identityHeld] : priorHeld;
    if (!publication) {
      if (acquisition.held.length) throw new Error(`PLURAL_VOTES_ACQUISITION_INCOMPLETE:${acquisition.held.map(row => row.detail).join(";")}`);
      await publish(await Promise.all(acquisition.acquisitions.map(row => holdPluralVoteEvidence(input.vault, row))), held);
    }
    const after = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
      controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
    const readerDatabaseBytes = after.reader - before.reader, controlPlaneDatabaseBytes = after.controlPlane - before.controlPlane;
    return { publication: publication!, held,
      resources: { peakRssBytes: process.resourceUsage().maxRSS * 1024, runtimeMs: performance.now() - started,
        readerDatabaseBytes, controlPlaneDatabaseBytes, databaseBytes: readerDatabaseBytes + controlPlaneDatabaseBytes } };
  } finally { await sink.close(); }
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
    memberPositions: projection.rollCalls.reduce((sum, vote) => sum + (vote.positionCount ?? vote.positions.length), 0),
    heldFacts: refreshed.held.length, ...refreshed.resources, unchanged: Boolean(refreshed.publication.outcome.confirmed) }));
  printSourceRunnerReceipt(pluralVotesContract(state), refreshed.publication.candidate, refreshed.publication.outcome);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
