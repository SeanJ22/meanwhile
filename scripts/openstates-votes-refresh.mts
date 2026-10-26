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
import { canonicalCivicDataHash } from "../lib/civic-data/changes.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields, type SourceHashConfirmation } from "../lib/civic-data/source-hash.ts";
import { PLURAL_VOTES_PARSER, PLURAL_VOTES_SOURCE, type PluralVotesProjection } from "../lib/sources/plural/votes.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/** Manual invocation and the standing source task share this sole writer. */
export async function refreshStateVotes(input: Parameters<typeof acquireStateVotes>[0] & { civicStore: RoutineDataStore; vault: EvidenceStore; cache?: CivicReadCache }) {
  const started = performance.now();
  const before = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
    controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
  const head = await input.civicStore.readSourceHead("STATE_ROLL_CALL",pluralVotesScope(input.state));
  const sourceProbe = head ? await input.civicStore.readCandidatePath<{formatVersion:number;rawHash:string;complete:boolean}>(head.versionId,["normalizedPayload","sourceProbe"]) : null;
  let sink: Awaited<ReturnType<typeof createVoteRefreshSink<PluralVotesProjection>>>["sink"] | null = null;
  const copies = (input.cache ?? runtimeCivicReadCache()).jobState(), progressKey = pluralVotesScope(input.state);
  let progress: PluralVoteProgress = input.resume ?? await copies.readCheckpoint<PluralVoteProgress>("openstates-vote-progress", progressKey) ?? {};
  let baseVersionId: string | null = null;
  const priorAcquisitions = async () => baseVersionId ? await input.civicStore.readCandidatePath<PluralVoteAcquisition[]>(baseVersionId,["normalizedPayload","acquisitions"]) ?? [] : [];
  let acquisitions: PluralVoteAcquisition[] = [];
  let priorHeld: {key:string;detail:string}[] = [];
  const initialize = async () => {
    if (sink) return sink;
    const initialized=await createVoteRefreshSink<PluralVotesProjection>({state:pluralVoteState(input.state).toUpperCase(),sourceId:PLURAL_VOTES_SOURCE,
      scope:pluralVotesScope(input.state),civicStore:input.civicStore,vault:input.vault,signal:input.signal,cache:input.cache,
      readPrior:()=>readPluralVotesProjection(input.state,{store:input.civicStore,now:input.now?.()})});
    sink=initialized.sink; baseVersionId=initialized.baseVersionId;
    acquisitions=await priorAcquisitions();
    priorHeld=baseVersionId ? await input.civicStore.readCandidatePath<{key:string;detail:string}[]>(baseVersionId,["normalizedPayload","held"])??[] : [];
    return sink;
  };
  bindVotePageVault(input.civicStore, input.vault);
  let publication = null as { candidate: RoutineCandidate; outcome: PromotionOutcome } | null;
  const identityHeld: { key: string; detail: string }[] = [];
  const publish = async (acquired: readonly PluralVoteAcquisition[], held: readonly { key: string; detail: string }[], checkpoints: PluralVoteProgress = {},
    probe?: {formatVersion:1;rawHash:string;complete:boolean}) => {
    const activeSink=await initialize();
    acquisitions = [...new Map([...acquisitions,...acquired].map(row=>[`${row.finalUrl}\n${row.sha256}`,row])).values()];
    const candidate = pluralVotesCandidate({ projection: await activeSink.snapshot(), acquired:acquisitions, held, checkedAt: input.now?.() ?? new Date().toISOString(),
      ...(probe ? {sourceProbe:probe} : {}) });
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
        const issue = await (await initialize()).put(vote);
        if (issue) { const detail = { key: vote.id, detail: issue }; held.push(detail); identityHeld.push(detail); }
      }
      // Publish and save the source position before requesting the next bounded batch.
      await publish([await holdPluralVoteEvidence(input.vault, result.evidence)],held,result.checkpoints);
      await input.onBill?.(result);
    } });
    const rawHash=canonicalCivicDataHash({sources:acquisition.acquisitions.filter(row=>!/^https:\/\/v3\.openstates\.org\/bills\/ocd-bill\//.test(row.requestedUrl))
      .map(row=>[row.requestedUrl,row.finalUrl,row.sha256]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),progress});
    let confirmation: SourceHashConfirmation | null = null;
    const fresh=acquisition.acquisitions.at(-1);
    if (!publication && fresh && !acquisition.held.length && sourceProbe?.formatVersion===1 && sourceProbe.complete && sourceProbe.rawHash===rawHash)
      confirmation=await confirmSourceHashUnchanged({store:input.civicStore,sourceId:PLURAL_VOTES_SOURCE,recordClass:"STATE_ROLL_CALL",scope:pluralVotesScope(input.state),
        parserVersion:PLURAL_VOTES_PARSER,rawHash,now:input.now?.()??new Date().toISOString(),complete:true,
        retrieval:{requestedUrl:fresh.requestedUrl,finalUrl:fresh.finalUrl,httpStatus:200,rawHash,retrievedAt:fresh.retrievedAt,
          ...(fresh.sourceCheck?{sourceCheck:fresh.sourceCheck}:{})}});
    if (confirmation) return {confirmation,publication:null,held:null,resources:null};
    if (!publication && acquisition.held.length) throw new Error(`PLURAL_VOTES_ACQUISITION_INCOMPLETE:${acquisition.held.map(row => row.detail).join(";")}`);
    await initialize();
    const held = publication ? [...acquisition.held, ...identityHeld] : priorHeld;
    await publish(await Promise.all(acquisition.acquisitions.map(row => holdPluralVoteEvidence(input.vault, row))), held,{},
      {formatVersion:1,rawHash,complete:!acquisition.held.some(row=>/^https?:\/\/|^ocd-bill\//.test(row.key))});
    const after = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
      controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
    const readerDatabaseBytes = after.reader - before.reader, controlPlaneDatabaseBytes = after.controlPlane - before.controlPlane;
    return { confirmation:null,publication: publication!, held,
      resources: { peakRssBytes: process.resourceUsage().maxRSS * 1024, runtimeMs: performance.now() - started,
        readerDatabaseBytes, controlPlaneDatabaseBytes, databaseBytes: readerDatabaseBytes + controlPlaneDatabaseBytes } };
  } finally { await (sink as Awaited<ReturnType<typeof createVoteRefreshSink<PluralVotesProjection>>>["sink"] | null)?.close(); }
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
  if(refreshed.confirmation){
    console.log("RCD_RECEIPT="+JSON.stringify({source:pluralVotesContract(state),...sourceHashReceiptFields(refreshed.confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));
    return;
  }
  const projection = refreshed.publication!.candidate.readModel as import("../lib/sources/plural/votes.ts").PluralVotesProjection;
  console.log(JSON.stringify({ state: state.toUpperCase(), rollCalls: projection.rollCalls.length,
    memberPositions: projection.rollCalls.reduce((sum, vote) => sum + (vote.positionCount ?? vote.positions.length), 0),
    heldFacts: refreshed.held.length, ...refreshed.resources, unchanged: Boolean(refreshed.publication!.outcome.confirmed) }));
  printSourceRunnerReceipt(pluralVotesContract(state), refreshed.publication!.candidate, refreshed.publication!.outcome);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
