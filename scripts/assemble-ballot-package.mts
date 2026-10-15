import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ballotElectionKey, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { requireBallotState, stateBallotContractId, type BallotState } from "../lib/ballot/state-scopes.ts";
import type { BallotSet, Contest } from "../lib/ballot/types.ts";
import { completeOfficialBallotContests, manualProjectionCandidate, readManualProjectionPrior,
} from "../lib/civic-data/manual-projections.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { authorityForManualReceipt } from "../lib/civic-data/source-authority.ts";
import { mergeBallotContests } from "../lib/civic-data/worker-ballot-contests.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { ballotInputHash, ballotInputStamp } from "../lib/civic-data/ballot-input.ts";
import type { BallotContestHold, BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

export interface BallotStateFile {
  readonly ballots: GenericBallotProjection["ballots"];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = resolve(root, "data/ballot/2026-general");

function authorityIndex(receipt: ManualSourceSetReceipt): Map<string, string> {
  const values = new Map<string, string>();
  for (const source of receipt.sources) if (source.reviewOutcome !== "BLOCKED" &&
    ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass)) {
    values.set(source.requestedUrl, source.publisher); values.set(source.finalUrl, source.publisher);
  }
  return values;
}

function currentStateInput(input: BallotStateFile, state: BallotState): GenericBallotProjection {
  const complete = new Set(completeOfficialBallotContests({ kind: "ballot-contests", ballots: input.ballots }, input.sourceReceipt).map(row => row.contest.id));
  const ballots: Record<string, BallotSet> = {};
  for (const [key, raw] of Object.entries(input.ballots)) {
    if (raw.election?.state !== state || key !== ballotElectionKey(raw)) throw new Error("BALLOT_STATE_SCOPE_MISMATCH");
    const heldContests = raw.contests.filter(contest => contest.type !== "MEASURE" && !complete.has(contest.id))
      .map(({ id, electionId, ocdId, title, provenance }) => ({ id, electionId, ocdId, title, provenance,
        reason: "The official candidate list hasn't been fully checked." }));
    const heldIds = new Set(heldContests.map(row => row.id));
    const candidacies = raw.candidacies.filter(row => !heldIds.has(row.contestId));
    const candidates = new Set(candidacies.map(row => row.id));
    ballots[key] = { ...raw, heldContests, contests: raw.contests.filter(row => !heldIds.has(row.id)), candidacies,
      ...(raw.contacts ? { contacts: raw.contacts.filter(row => candidates.has(row.candidacyId)) } : {}) };
  }
  return { kind: "ballot-contests", ballots };
}

function newerBallot(next: BallotSet, before: BallotSet | undefined, currentAuthority: ReadonlyMap<string, string>, priorAuthority: ReadonlyMap<string, string>): BallotSet {
  if (!before) return next;
  if (next.election.date !== before.election.date) throw new Error("Election date conflicts with the published ballot.");
  const published = new Map(before.contests.map(row => [row.id, row]));
  const held = new Map(before.heldContests?.map(row => [row.id, row]));
  const sameAuthority = (old: Pick<Contest, "provenance">, next: Pick<Contest, "provenance">) => {
    if (priorAuthority.get(old.provenance.sourceUrl ?? "") !== currentAuthority.get(next.provenance.sourceUrl ?? "")) {
      throw new Error("Contest authority conflicts with the published ballot.");
    }
  };
  const contests = next.contests.filter(contest => {
    const old = published.get(contest.id) ?? held.get(contest.id);
    if (old && Date.parse(old.provenance.collectedAt) > Date.parse(contest.provenance.collectedAt)) return false;
    if (old) sameAuthority(old, contest);
    return true;
  });
  const heldContests = next.heldContests?.filter(contest => {
    if (published.get(contest.id)?.candidateListComplete === true) return false;
    const old = held.get(contest.id) ?? published.get(contest.id);
    if (old && Date.parse(old.provenance.collectedAt) > Date.parse(contest.provenance.collectedAt)) return false;
    if (old) sameAuthority(old, contest);
    return true;
  });
  const accepted = new Set(contests.map(row => row.id));
  return { ...next, heldContests, contests, candidacies: next.candidacies.filter(row => accepted.has(row.contestId)),
    measures: next.measures.filter(row => accepted.has(row.contestId)),
    ...(next.measureRecords ? { measureRecords: next.measureRecords.filter(row => accepted.has(row.contestId)) } : {}) };
}

export async function assembleBallotPackage(options: { state: BallotState; directory?: string; store: CivicDataReadStore; now?: string }) {
  const state = requireBallotState(options.state), now = options.now ?? new Date().toISOString();
  const contractId = stateBallotContractId("ballot-contests", state);
  const file = `${state.toLowerCase()}.json`;
  const input = JSON.parse(await readFile(resolve(options.directory ?? stateDirectory, file), "utf8")) as BallotStateFile;
  if (!input.ballots || !Object.keys(input.ballots).length || !input.sourceReceipt) throw new Error("A state file needs ballots and sourceReceipt.");
  const prior = await readManualProjectionPrior(contractId, options.store, now);
  const temporal = prior ? (await options.store.readCandidate(prior.versionId))!.candidate.temporal : null;
  const current = currentStateInput(input, state);
  const before = prior?.payload as GenericBallotProjection | undefined;
  const currentAuthority = authorityIndex(input.sourceReceipt), priorAuthority = authorityIndex(prior?.sourceReceipt ?? input.sourceReceipt);
  const ballots = Object.fromEntries(Object.entries(current.ballots).map(([key, ballot]) =>
    [key, newerBallot(ballot, before?.ballots[key], currentAuthority, priorAuthority)]));
  const sourceThrough = [...input.sourceReceipt.sources.map(row => row.retrievedAt), ...temporal?.sourceThrough ? [temporal.sourceThrough] : []]
    .reduce((latest, stamp) => Date.parse(stamp) > Date.parse(latest) ? stamp : latest, input.sourceReceipt.reviewedAt);
  const merged = mergeBallotContests({ contractId, version: temporal?.version ?? "2026-general", sourceThrough,
    sourceReceipt: { ...input.sourceReceipt, reviewedAt: now, reviewedBy: "assemble-ballot-package" }, payload: { kind: "ballot-contests", ballots } }, prior);
  const candidate = manualProjectionCandidate(merged, { prior });
  const proof = authorityForManualReceipt(candidate.sourceId, candidate.recordClass, merged.sourceReceipt, candidate.retrieval.finalUrl);
  if (!proof.ok) throw new Error(proof.detail);
  if (!candidate.retrieval.succeeded || candidate.normalization.missingRequiredFields.length || candidate.semantics.violations.length) {
    throw new Error([...candidate.normalization.missingRequiredFields, ...candidate.semantics.violations,
      candidate.retrieval.failureDetail ?? ""].filter(Boolean).join(" "));
  }
  const heldContests: BallotContestHold[] = Object.values((merged.payload as GenericBallotProjection).ballots)
    .flatMap(ballot => (ballot.heldContests ?? []).map(row => ({ state, contestId: row.id, title: row.title, reason: row.reason })));
  return { package: merged, candidate, merged: [file], skipped: [] as { file: string; reason: string }[], heldContests, prior };
}

export async function runBallotPublication(options: { state: BallotState; directory?: string; store?: RoutineDataStore; now?: string }) {
  prepareProductionCivicDataWrite();
  const state = requireBallotState(options.state), directory = options.directory ?? stateDirectory;
  const at = options.now ?? new Date().toISOString(), contractId = stateBallotContractId("ballot-contests", state);
  const inputStamp = await ballotInputStamp(directory, state);
  const inputHash = await ballotInputHash(directory, state);
  let merged: string[] = [], skipped: { file: string; reason: string }[] = [];
  let heldContests: BallotContestHold[] = [], receipt: RoutineRunnerReceipt | null = null, report: BallotPublicationResult;
  try {
    const store = options.store ?? new PostgresRoutineDataStore();
    const result = await assembleBallotPackage({ state, directory, store, now: at });
    ({ merged, skipped, heldContests } = result);
    const outcome = await processRegisteredManualCandidate(store, contractId, result.candidate, at, result.prior?.versionId ?? null);
    receipt = { source: contractId, ...routineReceiptFields(result.candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
    report = { kind: "BALLOT_PUBLICATION", state, inputHash, inputStamp, at, merged, skipped, heldContests,
      status: outcome.promoted || outcome.confirmed ? "PUBLISHED" : "HELD", versionId: receipt.promotedVersion,
      reason: outcome.promoted || outcome.confirmed ? null : outcome.candidate.failureDetail ?? "Ballot validation held the published prior." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!merged.length) skipped = [{ file: `${state.toLowerCase()}.json`, reason }];
    report = { kind: "BALLOT_PUBLICATION", state, inputHash, inputStamp, at, merged, skipped, heldContests, status: "HELD", versionId: null, reason };
  }
  return { report, receipt, exitCode: report.status === "PUBLISHED" ? 0 : 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const state = requireBallotState(process.argv.find(arg => arg.startsWith("--state="))?.slice(8) ?? "");
  const result = await runBallotPublication({ state });
  console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result.report));
  if (result.receipt) console.log("RCD_RECEIPT=" + JSON.stringify(result.receipt));
  process.exitCode = result.exitCode;
}
