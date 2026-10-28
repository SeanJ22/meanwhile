import { pathToFileURL } from "node:url";
import { acquireLegiscanVotes, legiscanDatasetListUrl, type LegiscanCompletedDataset } from "../lib/sources/legiscan/vote-acquisition.ts";
import { digest, legiscanState, type LegiscanIdentityAuthority } from "../lib/sources/legiscan/dataset.ts";
import { legiscanVotesCandidate, legiscanVotesContract, legiscanVotesScope, mergeLegiscanVoteMetadata, readLegiscanVotesProjection,
  type LegiscanVoteSourceProbe, type LegiscanVotesProjection } from "../lib/sources/legiscan/votes.ts";
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
import { readSourceProbeDependencies } from "../lib/civic-data/source-probe.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields, type SourceHashConfirmation } from "../lib/civic-data/source-hash.ts";
import { LEGISCAN_VOTES_PARSER, LEGISCAN_VOTES_SOURCE, type LegiscanDatasetEvidence } from "../lib/sources/legiscan/dataset.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/** Current session datasets stream through the existing registered publication. */
export async function refreshLegiscanVotes(input: Omit<Parameters<typeof acquireLegiscanVotes>[0], "holders"> & { civicStore: RoutineDataStore; vault?: EvidenceStore }) {
  const started = performance.now(), before = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
    controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
  const state = legiscanState(input.state), now = input.now?.() ?? new Date().toISOString();
  const vault = input.vault ?? input.store ?? rawCaptureVault();
  const scope = legiscanVotesScope(state);
  const dependencies = await readSourceProbeDependencies(input.civicStore, [{recordClass:"STATE_LEGISLATOR",scope:`US-${state}:openstates-people:v1`}]);
  const head = await input.civicStore.readSourceHead("STATE_ROLL_CALL",scope);
  const probe = head ? await input.civicStore.readCandidatePath<LegiscanVoteSourceProbe>(head.versionId,["normalizedPayload","sourceProbe"]) : null;
  const completed=new Map<number,LegiscanCompletedDataset>();
  let sink: Awaited<ReturnType<typeof createVoteRefreshSink<LegiscanVotesProjection>>>["sink"] | null = null;
  let baseVersionId: string | null = null;
  let projection: LegiscanVotesProjection | null = null;
  let authority: LegiscanIdentityAuthority | null = null;
  let listing: LegiscanDatasetEvidence | null = null;
  let confirmation: SourceHashConfirmation | null = null;
  let holders: Awaited<ReturnType<typeof readOpenStatesPeopleProjection>> | null = null;
  const initialize = async () => {
    if (sink) return sink;
    holders = await readOpenStatesPeopleProjection(`US-${state}`, {store:input.civicStore,now});
    if (holders.kind !== "PROMOTED" || !holders.metadata.versionId) throw new Error("LEGISCAN_OPENSTATES_IDENTITY_UNAVAILABLE");
    const initialized = await createVoteRefreshSink<LegiscanVotesProjection>({state,sourceId:"legiscan",scope,civicStore:input.civicStore,vault,
      signal:input.signal,readPrior:()=>readLegiscanVotesProjection(state,{store:input.civicStore,now})});
    sink=initialized.sink; baseVersionId=initialized.baseVersionId; projection=initialized.priorMetadata;
    authority={sourceId:"plural-openstates",scope:holders.metadata.scope,versionId:holders.metadata.versionId,crosswalkSha256:digest([]),joins:[]};
    return sink;
  };
  const sourceProbe = (complete: boolean): LegiscanVoteSourceProbe => ({formatVersion:1,listingHash:listing!.sha256,dependencies,complete,
    completedDatasets:[...completed.values()]});
  bindVotePageVault(input.civicStore, vault);
  let publication: { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome } | null = null;
  const publish = async (candidate: ReturnType<typeof legiscanVotesCandidate>) => {
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, legiscanVotesContract(state), candidate, input.now?.() ?? now, baseVersionId,
      {confirmUnchanged:false});
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`LEGISCAN_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    projection = { ...candidate.readModel as NonNullable<typeof projection>, rollCalls: [] };
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
  };
  const identityHeld: { key: string; detail: string }[] = [];
  try {
    const acquisition = await acquireLegiscanVotes({ ...input,
      onListing: async (value,sessions) => {
        listing=value;
        if(probe?.formatVersion===1&&digest(probe.dependencies)===digest(dependencies)){
          for(const saved of probe.completedDatasets??[])if(sessions.some(session=>session.sessionId===saved.session.sessionId&&session.datasetHash===saved.session.datasetHash))
            completed.set(saved.session.sessionId,saved);
        }
        if (head?.rawHash && probe?.complete && probe.formatVersion===1 && probe.listingHash===value.sha256 && digest(probe.dependencies)===digest(dependencies)) {
          confirmation=await confirmSourceHashUnchanged({store:input.civicStore,sourceId:LEGISCAN_VOTES_SOURCE,recordClass:"STATE_ROLL_CALL",scope,
            parserVersion:LEGISCAN_VOTES_PARSER,rawHash:head.rawHash,now:input.now?.()??now,complete:true,
            retrieval:{requestedUrl:value.requestedUrl,finalUrl:value.finalUrl,httpStatus:200,rawHash:head.rawHash,retrievedAt:value.retrievedAt,
              ...(value.sourceCheck?{sourceCheck:value.sourceCheck}:{})}});
          if (confirmation) return false;
        }
        return true;
      }, completedDataset:async session=>completed.get(session.sessionId)??null,holders: async () => {
        await initialize();
        if (holders?.kind!=="PROMOTED") throw new Error("LEGISCAN_OPENSTATES_IDENTITY_UNAVAILABLE");
        return holders.value.roster.officeholders;
      },
      onVote: async vote => {
        const issue = await (await initialize()).put(vote);
        if (issue) identityHeld.push({ key: vote.id, detail: issue });
        await input.onVote?.(vote);
      }, onDataset: async result => {
        const {members:_members,...evidence}=result.evidence;
        completed.set(result.session.sessionId,{session:result.session,evidence,rollCalls:result.rollCalls,memberVotes:result.memberVotes,
          unmatchedPositions:result.unmatchedPositions,held:[...result.held,...identityHeld]});
        const joins = result.joins;
        const next = { ...mergeLegiscanVoteMetadata(projection, { state, datasets: [{ state, sessionId: result.session.sessionId,
          sessionName: result.session.sessionName, datasetHash: result.session.datasetHash, datasetDate: result.session.datasetDate, downloadedAt: result.evidence.retrievedAt }],
          identityAuthority: { ...authority!, joins, crosswalkSha256: digest(joins) } }), ...await (await initialize()).snapshot() };
        await publish(legiscanVotesCandidate({ projection: next, acquired: [result.evidence], held: [...result.held,...identityHeld], checkedAt: input.now?.() ?? now,sourceProbe:sourceProbe(false) }));
        await input.onDataset?.(result);
      } });
    const confirmed=confirmation as SourceHashConfirmation|null;
    if (confirmed) return {confirmation:confirmed,publication:null,held:null,state,rollCalls:null,positions:null,resources:null};
    if (!acquisition.completed.length && acquisition.held.some(row => row.key.startsWith("session:"))) throw new Error("LEGISCAN_DATASETS_UNAVAILABLE");
    const activeSink=await initialize();
    const next = { ...mergeLegiscanVoteMetadata(projection, { state, datasets: [], identityAuthority: authority! }), ...await activeSink.snapshot() };
    await publish(legiscanVotesCandidate({ projection: next, acquired: [acquisition.listing, ...acquisition.completed.map(result => result.evidence)], held: [...acquisition.held,...identityHeld], checkedAt: input.now?.() ?? now,
      sourceProbe:sourceProbe(!acquisition.held.some(row=>row.key.startsWith("session:"))) }));
    const after = processNeonBytes().reduce((sum,row) => ({ reader: sum.reader + row.bytes.reader,
      controlPlane: sum.controlPlane + row.bytes["control-plane"] }), { reader: 0, controlPlane: 0 });
    const readerDatabaseBytes = after.reader - before.reader, controlPlaneDatabaseBytes = after.controlPlane - before.controlPlane;
    return { confirmation:null,publication: publication as unknown as { candidate: ReturnType<typeof legiscanVotesCandidate>; outcome: PromotionOutcome }, held: [...acquisition.held,...identityHeld],
      state, rollCalls: next.rollCalls.length, positions: next.rollCalls.reduce((sum,vote) => sum + (vote.positionCount ?? vote.positions.length), 0),
      resources: { peakRssBytes: process.resourceUsage().maxRSS * 1024, runtimeMs: performance.now() - started,
        readerDatabaseBytes, controlPlaneDatabaseBytes, databaseBytes: readerDatabaseBytes + controlPlaneDatabaseBytes } };
  } finally { await (sink as Awaited<ReturnType<typeof createVoteRefreshSink<LegiscanVotesProjection>>>["sink"] | null)?.close(); }
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
  if (refreshed.confirmation) {
    console.log("RCD_RECEIPT="+JSON.stringify({source:legiscanVotesContract(state),...sourceHashReceiptFields(refreshed.confirmation),structuralReleaseContract:ZERO_RELEASE_EVENTS}));
    return;
  }
  printSourceRunnerReceipt(legiscanVotesContract(state), refreshed.publication!.candidate, refreshed.publication!.outcome);
  console.log(JSON.stringify(refreshed.resources));
  console.log(`${state}: ${refreshed.rollCalls} roll calls; ${refreshed.positions} member positions; ${refreshed.held.length} held records.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
