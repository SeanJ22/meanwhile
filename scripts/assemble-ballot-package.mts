import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { requireBallotState, stateBallotContractId, stateBallotScope, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { manualProjectionCandidate, readManualProjectionPrior } from "../lib/civic-data/manual-projections.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { BallotContestMerge } from "../lib/civic-data/worker-ballot-contests.ts";
import { ballotInputHash, ballotInputStamp, readBallotStateFile } from "../lib/civic-data/ballot-input.ts";
import type { BallotContestHold, BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = resolve(root, "data/ballot/2026-general");

type PublicationStage = "input-metadata" | "prior-state" | "state-contests" | "state-records" | "candidate-build" | "promotion";
type StageObserver = (stage: PublicationStage, phase: "start" | "end") => void;

async function missingBallotInput(store: RoutineDataStore, state: BallotState, now: string): Promise<{
  status: BallotPublicationResult["status"]; versionId: string | null; reason: string; receipt: RoutineRunnerReceipt | null;
}> {
  const scope = stateBallotScope("ballot-contests", state), contractId = stateBallotContractId("ballot-contests", state);
  const prior = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", scope, { store, now, bypassCache: true });
  if (prior.kind !== "PROMOTED") return { status: "HELD", versionId: null, receipt: null,
    reason: `BALLOT_INPUT_MISSING_NO_HELD_STATE:${state}: no verified state ballot data is available.` };
  const versionId = prior.projection.versionId;
  if (Object.keys(prior.value.ballots).length) return { status: "HELD", versionId, receipt: null,
    reason: `BALLOT_INPUT_MISSING_PRIOR_RETAINED:${state}: the source file is missing; published ballot data remains available.` };
  const saved = await store.readCandidateSummary(versionId);
  const pointer = await store.readPromotionIdentity("BALLOT_CANDIDACY", scope);
  if (!saved || saved.state !== "PROMOTED" || !saved.acquisitionSucceeded || saved.receipt?.decision !== "GOOD" ||
    saved.candidate.scope !== scope || saved.candidate.recordClass !== "BALLOT_CANDIDACY" ||
    saved.candidate.sourceId !== prior.projection.sourceId || saved.promotedVersion !== versionId || saved.lastKnownGoodVersion !== versionId ||
    pointer?.versionId !== versionId || pointer.lastKnownGoodVersionId !== versionId || pointer.sourceId !== prior.projection.sourceId) {
    return { status: "HELD", versionId: null, receipt: null,
      reason: `BALLOT_INPUT_MISSING_PRIOR_UNVERIFIED:${state}: the held state version could not be reused.` };
  }
  return { status: "PUBLISHED", versionId, reason: `BALLOT_EMPTY_PRIOR_REUSED:${state}: no ballot data is held; the verified empty state record remains available.`,
    receipt: { source: contractId, candidateId: versionId, acquisitionSucceeded: saved.acquisitionSucceeded, state: saved.state,
      decision: saved.receipt.decision, promotedVersion: saved.promotedVersion, lastKnownGoodVersion: saved.lastKnownGoodVersion,
      structuralReleaseContract: ZERO_RELEASE_EVENTS } };
}

async function assembleBallotPackage(options: {
  state: BallotState; directory?: string; store: CivicDataReadStore; now?: string; onStage?: StageObserver;
}) {
  const state = requireBallotState(options.state), now = options.now ?? new Date().toISOString();
  const contractId = stateBallotContractId("ballot-contests", state), file = `${state.toLowerCase()}.json`;
  const path = resolve(options.directory ?? stateDirectory, file);
  options.onStage?.("input-metadata", "start");
  const input = await readBallotStateFile(path);
  if (!input.ballots || !Object.keys(input.ballots).length || !input.sourceReceipt) throw new Error("A state file needs ballots and sourceReceipt.");
  options.onStage?.("input-metadata", "end");
  options.onStage?.("prior-state", "start");
  let prior = await readManualProjectionPrior(contractId, options.store, now);
  const priorVersionId = prior?.versionId ?? null;
  options.onStage?.("prior-state", "end");
  let sourceThrough = prior?.temporal?.sourceThrough ?? input.sourceReceipt.reviewedAt;
  for (const row of input.sourceReceipt.sources) if (Date.parse(row.retrievedAt) > Date.parse(sourceThrough)) sourceThrough = row.retrievedAt;
  const merge = new BallotContestMerge({ contractId, version: prior?.temporal?.version ?? "2026-general", sourceThrough,
    sourceReceipt: { ...input.sourceReceipt, reviewedAt: now, reviewedBy: "assemble-ballot-package" },
    payload: { kind: "ballot-contests", ballots: input.ballots } }, prior, { checkAuthority: true });
  prior = null;
  options.onStage?.("state-contests", "start");
  await readBallotStateFile(path, (parts, row) => {
    if (parts.length === 3 && ["contests", "heldContests"].includes(parts[2])) merge.add(parts[1], parts[2], row);
  });
  options.onStage?.("state-contests", "end");
  options.onStage?.("state-records", "start");
  await readBallotStateFile(path, (parts, row) => {
    if (parts.length !== 3 || !["contests", "heldContests"].includes(parts[2])) merge.add(parts[1], parts.slice(2).join("."), row);
  });
  const merged = merge.finish();
  options.onStage?.("state-records", "end");
  options.onStage?.("candidate-build", "start");
  const candidate = manualProjectionCandidate(merged);
  if (!candidate.retrieval.succeeded || candidate.normalization.missingRequiredFields.length || candidate.semantics.violations.length) {
    throw new Error([...candidate.normalization.missingRequiredFields, ...candidate.semantics.violations,
      candidate.retrieval.failureDetail ?? ""].filter(Boolean).join(" "));
  }
  options.onStage?.("candidate-build", "end");
  const heldContests: BallotContestHold[] = Object.values((merged.payload as GenericBallotProjection).ballots)
    .flatMap(ballot => (ballot.heldContests ?? []).map(row => ({ state, contestId: row.id, title: row.title, reason: row.reason })));
  return { package: merged, candidate, merged: [file], skipped: [] as { file: string; reason: string }[], heldContests, priorVersionId };
}

export async function runBallotPublication(options: { state: BallotState; directory?: string; store?: RoutineDataStore; now?: string; onStage?: StageObserver }) {
  prepareProductionCivicDataWrite();
  const state = requireBallotState(options.state), directory = options.directory ?? stateDirectory;
  const at = options.now ?? new Date().toISOString(), contractId = stateBallotContractId("ballot-contests", state);
  const inputStamp = await ballotInputStamp(directory, state);
  const inputHash = inputStamp.startsWith("content:") ? inputStamp.slice(8) : await ballotInputHash(directory, state);
  let merged: string[] = [], skipped: { file: string; reason: string }[] = [];
  let heldContests: BallotContestHold[] = [], receipt: RoutineRunnerReceipt | null = null, report: BallotPublicationResult;
  let store = options.store;
  try {
    store ??= new PostgresRoutineDataStore();
    const result = await assembleBallotPackage({ state, directory, store, now: at, onStage: options.onStage });
    ({ merged, skipped, heldContests } = result);
    options.onStage?.("promotion", "start");
    const outcome = await processRegisteredManualCandidate(store, contractId, result.candidate, at, result.priorVersionId);
    options.onStage?.("promotion", "end");
    receipt = { source: contractId, ...routineReceiptFields(result.candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
    report = { kind: "BALLOT_PUBLICATION", state, inputHash, inputStamp, at, merged, skipped, heldContests,
      status: outcome.promoted || outcome.confirmed ? "PUBLISHED" : "HELD", versionId: receipt.promotedVersion,
      reason: outcome.promoted || outcome.confirmed ? null : outcome.candidate.failureDetail ?? "Ballot validation held the published prior." };
  } catch (error) {
    let reason = error instanceof Error ? error.message : String(error);
    let status: BallotPublicationResult["status"] = "HELD", versionId: string | null = null;
    const missing = error as NodeJS.ErrnoException;
    if (store && missing?.code === "ENOENT" && missing.path === resolve(directory, `${state.toLowerCase()}.json`)) {
      try { ({ status, versionId, reason, receipt } = await missingBallotInput(store, state, at)); }
      catch (priorError) { reason = `BALLOT_INPUT_MISSING_PRIOR_UNVERIFIED:${state}: ${priorError instanceof Error ? priorError.message : String(priorError)}`; }
    }
    if (!merged.length) skipped = [{ file: `${state.toLowerCase()}.json`, reason }];
    report = { kind: "BALLOT_PUBLICATION", state, inputHash, inputStamp, at, merged, skipped, heldContests, status, versionId, reason };
  }
  return { report, receipt, exitCode: report.status === "PUBLISHED" ? 0 : 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const state = requireBallotState(process.argv.find(arg => arg.startsWith("--state="))?.slice(8) ?? "");
  const now = new Date().toISOString();
  prepareProductionCivicDataWrite();
  const result = await runBallotPublication({ state, now });
  console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result.report));
  if (result.receipt) console.log("RCD_RECEIPT=" + JSON.stringify(result.receipt));
  process.exitCode = result.exitCode;
}
