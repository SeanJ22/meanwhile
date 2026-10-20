import { pathToFileURL } from "node:url";
import { acquireStateVotes, pluralJurisdictionUrl } from "../lib/sources/plural/vote-acquisition.ts";
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
import { processNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** A source session checkpoints while it streams and when the next session starts. */
const VOTE_PUBLISH_SLICE_MS = 60_000;

/** Manual invocation and the standing source task share this sole writer. */
export async function refreshStateVotes(input: Parameters<typeof acquireStateVotes>[0] & { civicStore: RoutineDataStore; vault: EvidenceStore }) {
  const started = performance.now();
  const before = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
    controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
  const initialized = await createVoteRefreshSink({ state: pluralVoteState(input.state).toUpperCase(), sourceId: "plural-openstates-votes",
    scope: pluralVotesScope(input.state), civicStore: input.civicStore, vault: input.vault, signal: input.signal,
    readPrior: () => readPluralVotesProjection(input.state, { store: input.civicStore, bypassCache: true, now: input.now?.() }) });
  const sink = initialized.sink;
  let baseVersionId = initialized.baseVersionId;
  bindVotePageVault(input.civicStore, input.vault);
  let publication = null as { candidate: RoutineCandidate; outcome: PromotionOutcome } | null;
  const identityHeld: { key: string; detail: string }[] = [];
  let batch = { session: null as string | null, since: 0, acquired: [] as PluralVoteAcquisition[], held: [] as { key: string; detail: string }[] };
  const publish = async (acquired: readonly PluralVoteAcquisition[], held: readonly { key: string; detail: string }[]) => {
    const candidate = pluralVotesCandidate({ projection: await sink.snapshot(), acquired, held, checkedAt: input.now?.() ?? new Date().toISOString() });
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, pluralVotesContract(input.state), candidate,
      input.now?.() ?? new Date().toISOString(), baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`PLURAL_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
  };
  const flush = async () => {
    if (!batch.acquired.length) return;
    const { acquired, held } = batch;
    batch = { session: null, since: 0, acquired: [], held: [] };
    await publish(acquired, held);
  };
  try {
    const acquisition = await acquireStateVotes({ ...input, onBill: async result => {
      const session = result.session ?? result.votes[0]?.session ?? batch.session;
      if (batch.acquired.length && (session !== batch.session || Date.now() - batch.since >= VOTE_PUBLISH_SLICE_MS)) await flush();
      if (!batch.acquired.length) batch.since = Date.now();
      batch.session = session; batch.held.push(...result.held);
      for (const vote of result.votes) {
        const issue = await sink.put(vote);
        if (issue) { const held = { key: vote.id, detail: issue }; batch.held.push(held); identityHeld.push(held); }
      }
      // Bulk callbacks cite the same immutable source; keep one evidence row.
      if (!batch.acquired.some(row => row.sha256 === result.evidence.sha256)) batch.acquired.push(await holdPluralVoteEvidence(input.vault, result.evidence));
      await input.onBill?.(result);
    } });
    await flush();
    if (!publication) {
      if (acquisition.held.length) throw new Error(`PLURAL_VOTES_ACQUISITION_INCOMPLETE:${acquisition.held.map(row => row.detail).join(";")}`);
      await publish(await Promise.all(acquisition.acquisitions.map(row => holdPluralVoteEvidence(input.vault, row))), []);
    }
    const after = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
      controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
    const readerDatabaseBytes = after.reader - before.reader, controlPlaneDatabaseBytes = after.controlPlane - before.controlPlane;
    return { publication: publication!, held: [...acquisition.held, ...identityHeld],
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
