import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ballotElectionKey, genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { BallotSet, Contest } from "../lib/ballot/types.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { completeOfficialBallotContests, manualProjectionCandidate, readManualProjectionPrior,
  type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { authorityForManualReceipt } from "../lib/civic-data/source-authority.ts";
import { mergeBallotContests } from "../lib/civic-data/worker-ballot-contests.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import { assignment, flag } from "./cli-args.mts";

export interface BallotStateFile {
  readonly ballots: GenericBallotProjection["ballots"];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outside = (base: string, path: string) => {
  const from = relative(base, path);
  return isAbsolute(from) || from === ".." || from.startsWith("../");
};
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
  if (!accepted.length) return before;
  const key = ballotElectionKey(next);
  const fresh = { ...next, contests: accepted, candidacies: next.candidacies.filter(row => acceptedIds.has(row.contestId)),
    measures: next.measures.filter(row => acceptedIds.has(row.contestId)),
    ...(next.measureRecords ? { measureRecords: next.measureRecords.filter(row => acceptedIds.has(row.contestId)) } : {}) };
  const merged = mergeBallotContests({ contractId: "ballot-contests", version: "2026-general", sourceThrough: receipt.reviewedAt,
    sourceReceipt: receipt, payload: { kind: "ballot-contests", ballots: { [key]: fresh } } },
    { versionId: "published", payload: { kind: "ballot-contests", ballots: { [key]: before } }, sourceReceipt: priorReceipt });
  return (merged.payload as GenericBallotProjection).ballots[key];
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
  out: string;
  directory?: string;
  store?: CivicDataReadStore;
  now?: string;
}) {
  const out = resolve(options.out);
  if (!outside(root, out)) throw new Error("Ballot package --out must be outside the repository.");
  await mkdir(dirname(out), { recursive: true });
  const destination = resolve(await realpath(dirname(out)), out.split(/[\\/]/).at(-1)!);
  if (!outside(await realpath(root), destination)) throw new Error("Ballot package --out must be outside the repository.");
  try {
    if (!outside(await realpath(root), await realpath(out))) throw new Error("Ballot package --out must be outside the repository.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const now = options.now ?? new Date().toISOString();
  const store = options.store ?? new PostgresRoutineDataStore();
  const prior = await readManualProjectionPrior("ballot-contests", store, now);
  const temporal = prior ? (await store.readCandidate(prior.versionId))!.candidate.temporal : null;
  let ballots = { ...(prior?.payload as GenericBallotProjection | undefined)?.ballots };
  let sources = [...prior?.sourceReceipt.sources ?? []];
  const directory = options.directory ?? resolve(root, "data/ballot/2026-general");
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
      validate(packageFor({ kind: "ballot-contests", ballots: next }, receipt));
      ballots = next; sources = [...receipt.sources]; merged.push(file);
    } catch (error) { skipped.push({ file, reason: error instanceof Error ? error.message : String(error) }); }
  }
  const input = packageFor({ kind: "ballot-contests", ballots },
    { contractVersion: 1, reviewedAt: now, reviewedBy: "assemble-ballot-package", sources });
  validate(input);
  await writeFile(out, JSON.stringify(input, null, 2) + "\n");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const promoteCommand = `pnpm exec tsx scripts/promote-manual-civic-projection.mts --contract=ballot-contests --package=${quote(out)}`;
  return { package: input, out, merged, skipped, promoteCommand };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = assignment(process.argv, "out") ?? flag(process.argv, "out");
  if (!out) throw new Error("usage: pnpm exec tsx scripts/assemble-ballot-package.mts --out <absolute path outside repository>");
  const result = await assembleBallotPackage({ out });
  console.log(`Package: ${result.out}; ${Object.keys((result.package.payload as GenericBallotProjection).ballots).length} state/election ballots`);
  console.log(`Merged: ${result.merged.join(", ") || "none"}`);
  for (const skipped of result.skipped) console.log(`Skipped ${skipped.file}: ${skipped.reason}`);
  console.log(result.promoteCommand);
}
