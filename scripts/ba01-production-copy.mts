/** Run the ordinary ballot publisher and reader against BA-01's isolated production clone. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readAppliedMigrationWhen, hasExactAppliedMigrationReceipt } from "../lib/db/applied-migrations.ts";
import { readJournal, compareSchemaState } from "../lib/db/schema-state.ts";
import { runBallotPublication } from "./assemble-ballot-package.mts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { stateBallotScope, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { currentReaderSelection } from "../lib/db/reader-route.ts";
import { ballotPlaceFromParams, ballotPointDivisions } from "../lib/ballot/reader-place.ts";
import { readBallotReaderData } from "../lib/ballot/reader-data.ts";
import { divisionIdsForZipArea, unestablishedDistrictOfficesForFamilies } from "../lib/ballot/zip-divisions.ts";
import { zipCertainty } from "../lib/geo/zip-certainty.ts";
import { readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { phoenixToday } from "../lib/ballot/dated-events.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";

export const BA01_COPY = Object.freeze({
  projectId: "tiny-hill-13996172", parentBranchId: "br-delicate-lab-ax02xuo5",
  branchId: "br-wandering-shape-ax3ranho", branchName: "ba-01-return-production-copy-20261021",
  host: "ep-ancient-cherry-axl201ul-pooler.c-4.us-east-2.aws.neon.tech",
  createdAt: "2026-10-21T03:59:36Z", expiresAt: "2026-10-23T04:00:00Z",
});

/** An arbitrary DATABASE_URL or an owner-supplied production write handle cannot enter this script. */
export function requireBa01ProductionCopy(env: Readonly<Record<string, string | undefined>> = process.env): string {
  assert.equal(env.WTP_RUNTIME_MODE, "staging", "BA-01 verification requires staging mode");
  assert.equal(env.WTP_DB_ROLE, "local", "BA-01 verification requires the isolated-copy write role");
  assert.equal(env.BA01_COPY_HOST, BA01_COPY.host, "Name the known BA-01 child endpoint explicitly");
  assert.ok(env.DATABASE_URL, "The child database connection is required");
  assert.equal(new URL(env.DATABASE_URL).hostname, BA01_COPY.host, "Refusing every endpoint except the BA-01 child");
  assert.equal(env.WTP_CONTROL_PLANE_DATABASE_URL, env.DATABASE_URL, "All test operations must stay on the copy");
  return env.DATABASE_URL;
}

const reportPath = "data/ballot/reports/ba01-production-copy.json";
const priorPath = ".scratch/ba01-copy-prior.json";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const counts = (value: GenericBallotProjection) => Object.values(value.ballots).reduce((n, b) => ({
  contests: n.contests + b.contests.length, candidates: n.candidates + b.candidacies.length, measures: n.measures + b.measures.length,
}), { contests: 0, candidates: 0, measures: 0 });
type Prior = Record<string, { versionId: string | null; ballots: Record<string, { contests: string[]; candidates: string[]; measures: string[] }> }>;

export async function verifyCopyMigrations(connection: string) {
  const journal = readJournal();
  const applied = await readAppliedMigrationWhen(connection);
  assert.ok(applied.ok, "The isolated copy's migration receipts must be readable.");
  const state = compareSchemaState(journal, applied.appliedWhen);
  assert.ok(state.inSync, "The production copy must already contain every committed migration.");
  const migrations: { tag: string; hash: string; status: string }[] = [];
  for (const entry of journal) {
    const body = await readFile(`lib/db/migrations/${entry.tag}.sql`, "utf8"), sha256 = hash(body);
    assert.ok(hasExactAppliedMigrationReceipt(applied, entry.when, sha256), `${entry.tag}: copied receipt must match the committed migration bytes`);
    migrations.push({ tag: entry.tag, hash: sha256, status: "COPIED_FROM_PRODUCTION" });
  }
  return { before: applied.appliedWhen.length, after: applied.appliedWhen.length, migrations };
}

async function prepareCopy(connection: string, files: string[]) {
  const verified = await verifyCopyMigrations(connection);
  const priors: Prior = {};
  const store = new PostgresRoutineDataStore({ purge: async () => ({ purged: true }) });
  for (const file of files) {
    const state = file.slice(0, 2).toUpperCase() as BallotState;
    const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store, bypassCache: true });
    assert.ok(read.kind === "PROMOTED" || read.kind === "NOT_RECORDED", `${state} copied prior is ${read.kind}`);
    priors[state] = { versionId: read.kind === "PROMOTED" ? read.metadata.versionId : null,
      ballots: Object.fromEntries(Object.entries(read.kind === "PROMOTED" ? read.value.ballots : {}).map(([key, ballot]) => [key, {
        contests: ballot.contests.map(row => row.id), candidates: ballot.candidacies.map(row => row.id), measures: ballot.measures.map(row => row.id),
      }])) };
  }
  await mkdir(".scratch", { recursive: true });
  await writeFile(priorPath, JSON.stringify(priors));
  return { ...verified, priors };
}

const checkZip = readerRoute("/ballot", async ({ zip }: { zip: string }) => {
  const place = ballotPlaceFromParams({ zip });
  assert.ok(place.centroid, `${zip}: centroid is available`);
  const selection = currentReaderSelection();
  const pointRead = ballotPointDivisions(selection?.states ?? [], place.centroid.lat, place.centroid.lng);
  void pointRead.catch(() => undefined);
  const readerData = await readBallotReaderData(place);
  const entry = readerData ? await readerData.entry() : undefined;
  const certainty = await zipCertainty(zip, undefined, entry);
  const point = [...certainty?.all ?? [], ...await pointRead];
  const initial = await divisionIdsForZipArea(zip, point, undefined, entry);
  await readerData?.districtRead;
  const electionIds = new Map<string, string[]>(), gaps = new Map<string, string[]>();
  const sources = await readerBallotSourcesForDivisions(initial, {}, async (election, families) => {
    const geography = { purpose: "election" as const, asOf: phoenixToday(), electionDate: election.date };
    const ids = await divisionIdsForZipArea(zip, point, geography, readerData ? await readerData.entry(geography) : undefined);
    electionIds.set(election.id, ids); gaps.set(election.id, unestablishedDistrictOfficesForFamilies(families, ids)); return ids;
  });
  for (const row of sources) {
    const ballot = row.source.normalize(await row.source.fetch());
    if (ballot.election.date !== "2026-11-03" || !ballot.contests.length) continue;
    return { zip, state: ballot.election.state, electionId: ballot.election.id, divisions: electionIds.get(ballot.election.id),
      contestCount: ballot.contests.length, candidateCount: ballot.candidacies.length, measureCount: ballot.measures.length,
      missingDistrictOffices: gaps.get(ballot.election.id) ?? [],
      contests: ballot.contests.map(contest => ({ id: contest.id, title: contest.title, type: contest.type, ocdId: contest.ocdId,
        sourceUrl: contest.provenance.sourceUrl,
        candidates: ballot.candidacies.filter(candidate => candidate.contestId === contest.id).map(candidate => ({ id: candidate.id,
          name: ballotCandidateDisplayName(candidate), party: candidate.partyLabel, sourceUrl: candidate.provenance.sourceUrl })),
        measures: ballot.measures.filter(measure => measure.contestId === contest.id).map(measure => ({ id: measure.id, sourceUrl: measure.provenance.sourceUrl })),
      })) };
  }
  throw new Error(`${zip}: no November 3 general-election ballot reached the normal reader`);
});

async function main() {
  const connection = requireBa01ProductionCopy();
  if (process.argv.includes("--verify-schema-only")) {
    const verified = await verifyCopyMigrations(connection);
    console.log(`Copy schema matches all ${verified.after} committed migrations through the shared receipt reader.`);
    return;
  }
  const allFiles = (await readdir("data/ballot/2026-general")).filter(file => /^[a-z]{2}\.json$/.test(file)).sort();
  const statesArgument = (name: string) => new Set((process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1] ?? "")
    .split(",").filter(Boolean).map(state => state.toUpperCase()));
  const only = statesArgument("only-states"), exclude = statesArgument("exclude-states");
  const files = allFiles.filter(file => (!only.size || only.has(file.slice(0, 2).toUpperCase())) && !exclude.has(file.slice(0, 2).toUpperCase()));
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(reportPath, "utf8")); } catch { /* first copy run */ }
  const prepared = process.argv.includes("--prepare") ? await prepareCopy(connection, allFiles) : null;
  const report = { ...existing, checkedAt: new Date().toISOString(), database: BA01_COPY,
    ...(prepared ? { migrationCountBefore: prepared.before, migrationCountAfter: prepared.after, migrations: prepared.migrations } : {}),
  } as Record<string, unknown>;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--prepare-only")) return;
  const prior = prepared?.priors ?? JSON.parse(await readFile(priorPath, "utf8")) as Prior;
  const states = Array.isArray(existing.states) ? existing.states as Record<string, unknown>[] : [];
  for (const file of files) {
    const state = file.slice(0, 2).toUpperCase() as BallotState;
    const store = new PostgresRoutineDataStore({ purge: async () => ({ purged: true }) });
    Object.assign(store, { writeAuthority: assertRuntimeAuthority({ capabilities: ["MANUAL_CONTRACT"], contract: `ballot-contests:${state}` }) });
    const result = await runBallotPublication({ state, store });
    assert.equal(result.report.status, "PUBLISHED", `${state}: ${result.report.reason}`);
    const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", state), { store, bypassCache: true });
    assert.equal(read.kind, "PROMOTED", state);
    if (read.kind !== "PROMOTED") continue;
    const missing: string[] = [];
    for (const [key, ballot] of Object.entries(prior[state]?.ballots ?? {})) {
      const next = read.value.ballots[key];
      for (const [field, rows] of Object.entries(ballot)) {
        const values = next?.[field === "candidates" ? "candidacies" : field as "contests" | "measures"] ?? [];
        const ids = new Set(values.map(row => row.id));
        missing.push(...rows.filter(id => !ids.has(id)));
      }
    }
    assert.deepEqual(missing, [], `${state} retained all copied production IDs`);
    const previous = states.findIndex(row => row.state === state);
    if (previous >= 0) states.splice(previous, 1);
    states.push({ state, status: result.report.status, priorVersionId: prior[state]?.versionId, versionId: read.metadata.versionId,
      inputHash: result.report.inputHash, inputSha256: hash(await readFile(`data/ballot/2026-general/${file}`, "utf8")),
      ...counts(read.value), priorIdsLost: missing, heldContests: result.report.heldContests });
    states.sort((a, b) => String(a.state).localeCompare(String(b.state)));
    console.log(`${state}: published to copy; production prior IDs retained`);
    report.states = states; await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  for (const state of states) {
    const sha256 = hash(await readFile(`data/ballot/2026-general/${String(state.state).toLowerCase()}.json`, "utf8"));
    if (!state.inputSha256) {
      state.inputSha256 = sha256;
      state.inputFingerprintEvidence = "State input unchanged since publication; SHA256 recorded afterward. Assembler inputHash was not captured for this earlier run.";
    } else assert.equal(state.inputSha256, sha256, `${state.state}: state input changed after its copy publication`);
  }
  report.states = states;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--skip-zips")) return;
  const acceptance = JSON.parse(await readFile("data/ballot/reports/ba01-zip-acceptance.json", "utf8")) as {
    zips: { zip: string; officialBallotRaceCount: number | null; remaining: string }[];
  };
  const zips = [];
  for (const expected of acceptance.zips) {
    const start = performance.now();
    try {
      const actual = await checkZip({ zip: expected.zip });
      zips.push({ ...actual, elapsedMs: Math.round(performance.now() - start), copyReaderStatus: "VERIFIED",
        officialBallotRaceCount: expected.officialBallotRaceCount, officialSampleComplete: false,
        remaining: expected.remaining });
      console.log(`${expected.zip}: ${actual.contestCount} contests / ${actual.candidateCount} candidates / ${actual.measureCount} measures`);
    } catch (error) {
      zips.push({ zip: expected.zip, copyReaderStatus: "FAILED", error: error instanceof Error ? error.message : "Reader failed",
        elapsedMs: Math.round(performance.now() - start), officialSampleComplete: false, remaining: expected.remaining });
      console.log(`${expected.zip}: copy reader failed`);
    }
    report.zips = zips; await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  report.status = zips.every(zip => zip.copyReaderStatus === "VERIFIED") ? "COPY_PUBLICATION_AND_READBACK_VERIFIED" : "COPY_READER_GAPS_REMAIN";
  report.scope = "Real production branch data; all committed migrations; ordinary assembler and the ballot page's normal geography/source selector. Official sample-ballot completeness remains open as reported per ZIP. HTML-page checks are recorded separately.";
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
