import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet, Contest } from "../lib/ballot/types.ts";
import { completeOfficialBallotContests, manualProjectionCandidate, readManualProjectionPrior, mergeBallotSourceReferences,
  type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { authorityForManualReceipt } from "../lib/civic-data/source-authority.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { ballotInputHash, type BallotPublicationResult } from "../lib/civic-data/ballot-publication.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { validateBallotMeasureEvidence } from "../lib/ballot/measure-evidence.ts";
import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";

export interface BallotStateFile {
  readonly ballots: GenericBallotProjection["ballots"];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = resolve(root, "data/ballot/2026-general");
class BallotAssemblyError extends Error {
  readonly merged: string[];
  readonly skipped: { file: string; reason: string }[];
  constructor(message: string, merged: string[], skipped: { file: string; reason: string }[]) {
    super(message); this.merged = merged; this.skipped = skipped;
  }
}
const authority = (contest: Contest, receipt: ManualSourceSetReceipt) => receipt.sources.find(source =>
  source.reviewOutcome !== "BLOCKED" && ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass) &&
  [source.requestedUrl, source.finalUrl].includes(contest.provenance.sourceUrl ?? ""))?.publisher;

function mergeBallot(next: BallotSet, before: BallotSet | undefined, receipt: ManualSourceSetReceipt, priorReceipt: ManualSourceSetReceipt): BallotSet {
  if (!before) return next;
  if (next.election.date !== before.election.date) throw new Error("Election date conflicts with the published ballot.");
  const accepted = next.contests.filter(contest => {
    const old = before.contests.find(row => row.id === contest.id);
    if (old && Date.parse(old.provenance.collectedAt) >= Date.parse(contest.provenance.collectedAt)) return false;
    if (old && authority(old, priorReceipt) !== authority(contest, receipt)) throw new Error(`Contest authority conflicts: ${contest.id}`);
    return true;
  });
  const acceptedIds = new Set(accepted.map(row => row.id));
  const newer = <T extends { retrievedAt: string }>(fresh: T | undefined, old: T | undefined) =>
    fresh && (!old || Date.parse(fresh.retrievedAt) >= Date.parse(old.retrievedAt)) ? fresh : old;
  const measures = new Map(before.measures.map(row => [row.contestId, row]));
  const records = new Map((before.measureRecords ?? []).map(row => [row.contestId, row]));
  for (const measure of next.measures) {
    const old = measures.get(measure.contestId);
    const contest = before.contests.find(row => row.id === measure.contestId);
    if (old && !acceptedIds.has(measure.contestId) && contest && authority(contest, priorReceipt) !==
      authority(next.contests.find(row => row.id === measure.contestId)!, receipt)) throw new Error(`Contest authority conflicts: ${measure.contestId}`);
    const question = !old || Date.parse(measure.provenance.collectedAt) > Date.parse(old.provenance.collectedAt) ? measure : old;
    const officialText = newer(measure.officialText, old?.officialText), voterGuide = newer(measure.voterGuide, old?.voterGuide);
    const merged = { ...question, ...(officialText ? { officialText } : {}), ...(voterGuide ? { voterGuide } : {}) };
    measures.set(measure.contestId, merged);
    const record = next.measureRecords?.find(row => row.contestId === measure.contestId), prior = records.get(measure.contestId);
    if (record && (!officialText || record.sourceHash === officialText.sourceHash && record.sourceUrl === officialText.sourceUrl) &&
      (!prior || Date.parse(record.writtenAt) >= Date.parse(prior.writtenAt))) records.set(measure.contestId, record);
    const held = records.get(measure.contestId);
    if (held && officialText && (held.sourceHash !== officialText.sourceHash || held.sourceUrl !== officialText.sourceUrl)) records.delete(measure.contestId);
  }
  const absences = new Map(before.absences.map(row => [row.ocdId, row]));
  for (const absence of next.absences) {
    const old = absences.get(absence.ocdId);
    if (!old || Date.parse(absence.provenance.collectedAt) >= Date.parse(old.provenance.collectedAt)) absences.set(absence.ocdId, absence);
  }
  const newEvidence = receipt.sources.some(source => !priorReceipt.sources.some(held => held.finalUrl === source.finalUrl &&
    held.rawHash === source.rawHash && Date.parse(held.retrievedAt) >= Date.parse(source.retrievedAt)));
  return { ...before,
    ...mergeBallotSourceReferences(next, before),
    contests: [...before.contests.filter(row => !acceptedIds.has(row.id)), ...accepted].map(contest => {
      const text = measures.get(contest.id)?.officialText;
      return text && contest.measureTextUrl !== text.sourceUrl ? { ...contest, measureTextUrl: text.sourceUrl } : contest;
    }),
    candidacies: [...before.candidacies.filter(row => !acceptedIds.has(row.contestId)), ...next.candidacies.filter(row => acceptedIds.has(row.contestId))],
    measures: [...measures.values()], absences: [...absences.values()],
    ...(newEvidence && next.coverageNotes !== undefined ? { coverageNotes: next.coverageNotes } : {}),
    ...(newEvidence && next.scopedCoverageNotes !== undefined ? { scopedCoverageNotes: next.scopedCoverageNotes } : {}),
    ...(before.measureRecords !== undefined || next.measureRecords !== undefined ? { measureRecords: [...records.values()] } : {}),
  };
}

function validate(input: ManualProjectionPackage): GenericBallotProjection {
  const payload = input.payload as GenericBallotProjection;
  const problems = genericBallotProblems(payload);
  if (problems.length) throw new Error(problems.join(" "));
  const candidate = manualProjectionCandidate(input);
  const proof = authorityForManualReceipt(candidate.sourceId, candidate.recordClass, input.sourceReceipt, candidate.retrieval.finalUrl);
  if (!proof.ok) throw new Error(proof.detail);
  if (!candidate.retrieval.succeeded || candidate.normalization.missingRequiredFields.length || candidate.semantics.violations.length) {
    throw new Error([...candidate.normalization.missingRequiredFields, ...candidate.semantics.violations,
      candidate.retrieval.failureDetail ?? ""].filter(Boolean).join(" "));
  }
  return payload;
}

export async function assembleBallotPackage(options: {
  directory?: string;
  store: CivicDataReadStore;
  now?: string;
  evidenceStore?: EvidenceStore;
}) {
  const now = options.now ?? new Date().toISOString();
  const store = options.store;
  const evidenceStore = options.evidenceStore ?? netlifyEvidenceStoreFromEnv();
  if (!evidenceStore) throw new Error("The Netlify measure evidence vault is unavailable.");
  const prior = await readManualProjectionPrior("ballot-contests", store, now);
  const temporal = prior ? (await store.readCandidate(prior.versionId))!.candidate.temporal : null;
  let ballots = { ...(prior?.payload as GenericBallotProjection | undefined)?.ballots };
  let sources = [...prior?.sourceReceipt.sources ?? []];
  const directory = options.directory ?? stateDirectory;
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const skipped: { file: string; reason: string }[] = [], merged: string[] = [];
  const packageFor = (value: GenericBallotProjection, receipt: ManualSourceSetReceipt): ManualProjectionPackage => ({
    contractId: "ballot-contests", version: temporal?.version ?? "2026-general",
    sourceThrough: [...receipt.sources.map(row => row.retrievedAt), ...temporal?.sourceThrough ? [temporal.sourceThrough] : []]
      .sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? now,
    sourceReceipt: receipt, payload: value,
  });
  for (const file of files.filter(file => file.endsWith(".json")).sort()) {
    try {
      const state = JSON.parse(await readFile(resolve(directory, file), "utf8")) as BallotStateFile;
      if (!state.ballots || !state.sourceReceipt) throw new Error("A state file needs ballots and sourceReceipt at its top level.");
      const fresh = validate(packageFor({ kind: "ballot-contests", ballots: state.ballots }, state.sourceReceipt));
      const entries = Object.entries(fresh.ballots);
      if (!/^[a-z]{2}\.json$/i.test(file) || entries.length !== 1 || entries[0][1].election.state !== file.slice(0, 2).toUpperCase()) {
        throw new Error("A state file must contain one ballot keyed by its filename's state and election id.");
      }
      const complete = new Set(completeOfficialBallotContests(fresh, state.sourceReceipt).map(row => row.contest.id));
      if (entries[0][1].contests.some(contest => contest.type !== "MEASURE" && !complete.has(contest.id))) {
        throw new Error("The candidate list lacks complete official ballot-contest evidence.");
      }
      const receipt: ManualSourceSetReceipt = { contractVersion: 1, reviewedAt: now, reviewedBy: "assemble-ballot-package",
        sources: [...new Map([...sources, ...state.sourceReceipt.sources].sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt))
          .map(source => [`${new URL(source.finalUrl).href}\n${source.rawHash}`, source])).values()] };
      const [key, ballot] = entries[0];
      const next = { ...ballots, [key]: mergeBallot(ballot, ballots[key], state.sourceReceipt,
        { ...receipt, sources }) };
      await validateBallotMeasureEvidence(next[key], evidenceStore, (prior?.payload as GenericBallotProjection | undefined)?.ballots[key]);
      validate(packageFor({ kind: "ballot-contests", ballots: next }, receipt));
      ballots = next; sources = [...receipt.sources]; merged.push(file);
    } catch (error) { skipped.push({ file, reason: error instanceof Error ? error.message : String(error) }); }
  }
  const input = packageFor({ kind: "ballot-contests", ballots },
    { contractVersion: 1, reviewedAt: now, reviewedBy: "assemble-ballot-package", sources });
  try { validate(input); }
  catch (error) { throw new BallotAssemblyError(error instanceof Error ? error.message : String(error), merged, skipped); }
  return { package: input, merged, skipped, prior };
}

export async function runBallotPublication(options: { directory?: string; store?: RoutineDataStore; now?: string; evidenceStore?: EvidenceStore } = {}) {
  prepareProductionCivicDataWrite();
  const directory = options.directory ?? stateDirectory;
  const at = options.now ?? new Date().toISOString();
  const inputHash = await ballotInputHash(directory);
  const scratch = await mkdtemp(resolve(tmpdir(), "ballot-publication-"));
  let merged: string[] = [], skipped: { file: string; reason: string }[] = [];
  let receipt: RoutineRunnerReceipt | null = null;
  let report: BallotPublicationResult;
  try {
    const store = options.store ?? new PostgresRoutineDataStore();
    const result = await assembleBallotPackage({ directory, store, now: at, evidenceStore: options.evidenceStore });
    ({ merged, skipped } = result);
    const packagePath = resolve(scratch, "package.json");
    await writeFile(packagePath, JSON.stringify(result.package, null, 2) + "\n");
    const candidate = manualProjectionCandidate(result.package, { prior: result.prior });
    const outcome = await processRegisteredManualCandidate(store, "ballot-contests", candidate, at, result.prior?.versionId ?? null);
    receipt = { source: "ballot-contests", ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
    report = { kind: "BALLOT_PUBLICATION", inputHash, at, merged, skipped,
      status: outcome.promoted || outcome.confirmed ? "PUBLISHED" : "HELD", versionId: receipt.promotedVersion,
      reason: outcome.promoted || outcome.confirmed ? null : outcome.candidate.failureDetail ?? "Ballot validation held the published prior." };
  } catch (error) {
    if (error instanceof BallotAssemblyError) ({ merged, skipped } = error);
    report = { kind: "BALLOT_PUBLICATION", inputHash, at, merged, skipped, status: "HELD", versionId: null,
      reason: error instanceof Error ? error.message : String(error) };
  } finally { await rm(scratch, { recursive: true, force: true }); }
  return { report, receipt, exitCode: report.status === "PUBLISHED" ? 0 : 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runBallotPublication();
  console.log("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(result.report));
  if (result.receipt) console.log("RCD_RECEIPT=" + JSON.stringify(result.receipt));
  process.exitCode = result.exitCode;
}
