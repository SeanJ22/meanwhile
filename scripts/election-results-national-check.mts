import { readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { neon } from "../lib/db/client.ts";
import { publicText } from "./election-results-check.mts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { servedBallots } from "../lib/election-results/runner.ts";
import { matchElectionResultAcrossBallots } from "../lib/election-results/matcher.ts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { readBallotpediaCongressSummary, readBallotpediaResults } from "../lib/election-results/ballotpedia.ts";
import { electionResultFix } from "../lib/election-results/publisher.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { ElectionResult } from "../lib/election-results/types.ts";
import type { Query } from "../lib/facts/publish.ts";

const STATES = Object.values(FIPS_TO_STATE).filter(row => row.prefix === "state").map(row => row.postal);
interface CopyMetadata {
  branchId: string; parentBranchId: string; host: string; primary: boolean; default: boolean; snapshotAt: string; expiresAt: string;
}
interface NationalBallotCopy { states: readonly string[]; ballots: readonly BallotSet[] }
interface ResultIdentities { races: ElectionResult[]; sourceErrors: unknown[]; catalogErrors: unknown[]; notPublishedStates?: string[] }

/** The audit never accepts a default/parent endpoint or an unverified connection target. */
export function assertIsolatedCopy(connection: string, metadata: CopyMetadata): void {
  const target = new URL(connection);
  if (!/^postgres(?:ql)?:$/.test(target.protocol) || target.hostname !== metadata.host || metadata.primary !== false || metadata.default !== false ||
      !/^br-/.test(metadata.branchId) || !metadata.parentBranchId || metadata.branchId === metadata.parentBranchId ||
      !Number.isFinite(Date.parse(metadata.snapshotAt)) || !Number.isFinite(Date.parse(metadata.expiresAt)) || Date.parse(metadata.expiresAt) <= Date.now())
    throw new Error("National election audit requires an explicitly identified, unexpired isolated database copy");
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (let index = next++; index < values.length; index = next++) output[index] = await work(values[index]);
  }));
  return output;
}

export function nationalResultCounts(copy: NationalBallotCopy, source: ResultIdentities) {
  const incomplete = STATES.filter(state => !copy.states.includes(state));
  if (incomplete.length || source.sourceErrors.length || source.catalogErrors.length) return { complete: false as const, incompleteStates: incomplete,
    sourceFailures: source.sourceErrors.length, catalogFailures: source.catalogErrors.length, nationalFixRows: null };
  const counts = { matchedRaces: 0, noContestFixRows: 0, candidateFixRows: 0, detectiveRows: 0, matchedCandidates: 0 };
  const byState: Record<string, typeof counts> = {};
  const work: { race: ElectionResult; reason: string; kind: "fix" | "detect"; details: Record<string, unknown> }[] = [];
  for (const race of source.races) {
    const match = matchElectionResultAcrossBallots(race, copy.ballots);
    const state = byState[race.state] ??= { matchedRaces: 0, noContestFixRows: 0, candidateFixRows: 0, detectiveRows: 0, matchedCandidates: 0 };
    if (match.kind === "matched") {
      state.matchedRaces++; counts.matchedRaces++;
      state.matchedCandidates += match.candidates.length; counts.matchedCandidates += match.candidates.length;
      if (match.unmatchedCandidates.length) {
        state.candidateFixRows++; counts.candidateFixRows++;
        work.push({ race, kind: "fix", reason: "Candidate missing from served ballot", details: { candidateNames: match.unmatchedCandidates.map(index => race.candidates[index].name) } });
      }
      if (match.ambiguousCandidates.length) {
        state.detectiveRows++; counts.detectiveRows++;
        work.push({ race, kind: "detect", reason: "Candidate identity tie", details: { candidateNames: match.ambiguousCandidates.map(index => race.candidates[index].name) } });
      }
    } else {
      if (match.kind === "unmatched") { state.noContestFixRows++; counts.noContestFixRows++; }
      else { state.detectiveRows++; counts.detectiveRows++; }
      work.push({ race, kind: match.kind === "unmatched" ? "fix" : "detect", reason: match.reason, details: { contestIds: match.contestIds } });
    }
  }
  return { complete: true as const, sourceRaces: source.races.length, ...counts, nationalFixRows: counts.noContestFixRows + counts.candidateFixRows, byState, work };
}

async function resultIdentities() {
  const checkedAt = new Date().toISOString(), sourceErrors: { url: string; reason: string }[] = [], catalogErrors: { url: string; reason: string }[] = [];
  const publishedStates = new Set<string>();
  const fetcher: typeof fetch = async request => new Response(await publicText(String(request)), { status: 200 });
  const identity = (race: ElectionResult): ElectionResult => ({ sourceId: race.sourceId, sourceName: race.sourceName, sourceUrl: race.sourceUrl,
    creditedSources: race.creditedSources, sourceRaceId: race.sourceRaceId, state: race.state, office: race.office, officeName: race.officeName,
    districtHint: race.districtHint, electionDate: race.electionDate, status: race.status, candidates: race.candidates.map(({ name }) => ({ name })),
    ...(race.measure ? { measure: { name: race.measure.name, number: race.measure.number, outcome: race.measure.outcome } } : {}), checkedAt, quote: "" });
  const url = "https://multistate.us/elections/data/live_results_general_2026.json";
  const races: ElectionResult[] = [];
  try {
    const batch = parseMultiStateResults(await publicText(url), checkedAt);
    races.push(...batch.races.map(identity));
    for (const summary of batch.summaries) publishedStates.add(summary.state);
  } catch (error) { sourceErrors.push({ url, reason: error instanceof Error ? error.message : String(error) }); }
  const catalogs = await mapConcurrent(["us_senate", "us_house"] as const, 2, async office => {
    try {
      const batch = await readBallotpediaCongressSummary(office, checkedAt, fetcher, true);
      catalogErrors.push(...batch.catalogErrors ?? []);
      const expected = office === "us_house" ? 435 : 35;
      if (batch.racePages?.length !== expected) catalogErrors.push({ url: batch.source.url!, reason: `Expected ${expected} ${office} pages; found ${batch.racePages?.length ?? 0}` });
      return batch.racePages ?? [];
    } catch (error) { catalogErrors.push({ url: `https://ballotpedia.org/${office}`, reason: error instanceof Error ? error.message : String(error) }); return []; }
  });
  await mapConcurrent(catalogs.flat(), 4, async route => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { races.push(...(await readBallotpediaResults(route, checkedAt, fetcher)).races.map(identity)); return; }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt < 2 && reason.includes("current general-election table")) continue;
        sourceErrors.push({ url: route.url, reason }); return;
      }
    }
  });
  return { checkedAt, races, sourceErrors, catalogErrors, notPublishedStates: STATES.filter(state => !publishedStates.has(state)) };
}

export async function checkNationalResults(args: readonly string[]) {
  for (const name of ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL_READONLY", "WTP_PRODUCTION_DATABASE_URL_READONLY"]) delete process.env[name];
  const option = (name: string) => { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error(`Required: ${name}`); return args[index + 1]; };
  const metadata = JSON.parse(await readFile(option("--copy-metadata"), "utf8")) as CopyMetadata;
  const connection = (await readFile(option("--copy-connection-file"), "utf8")).trim();
  assertIsolatedCopy(connection, metadata);
  const sql = neon(connection);
  let reads = 0;
  const query: Query = async (text, params = []) => {
    if (!/^\s*(?:SELECT|WITH)\b/i.test(text) || /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(text)) throw new Error("The national copy audit is read only");
    for (let attempt = 0; ; attempt++) {
      reads++;
      try { return await sql.query(text, [...params]) as Record<string, unknown>[]; }
      catch (error) {
        if (attempt >= 2 || error && typeof error === "object" && "code" in error && error.code) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  };
  const checkpoint = args.includes("--ballot-copy") ? option("--ballot-copy") : undefined;
  let saved: { branchId: string; states: string[]; ballots: BallotSet[] } = { branchId: metadata.branchId, states: [], ballots: [] };
  if (checkpoint) try { saved = JSON.parse(await readFile(checkpoint, "utf8")); }
  catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error; }
  if (saved.branchId !== metadata.branchId) throw new Error("The ballot copy belongs to another database branch");
  const ballots = saved.ballots;
  let saving = Promise.resolve();
  await mapConcurrent(STATES.filter(state => !saved.states.includes(state)), 4, async state => {
    ballots.push(...(await servedBallots(query, state)).map(({ election, contests, candidacies, measures }) => ({ election, contests, candidacies, measures, absences: [] })));
    saved.states.push(state);
    if (checkpoint) {
      const snapshot = JSON.stringify(saved);
      await (saving = saving.then(async () => { await writeFile(`${checkpoint}.next`, snapshot); await rename(`${checkpoint}.next`, checkpoint); }));
    }
    console.log(JSON.stringify({ phase: "full-state-authority", state, ballots: ballots.length }));
  });
  const source: ResultIdentities = args.includes("--sources") ? JSON.parse(await readFile(option("--sources"), "utf8")) : await resultIdentities();
  const found = nationalResultCounts({ states: STATES, ballots }, source);
  if (!found.complete) { console.log(JSON.stringify(found)); process.exitCode = 1; return; }
  const { factDb } = await import("../tests/helpers/fact-db.ts");
  const { WORK_DDL } = await import("../lib/core/work.ts");
  const local = await factDb();
  let workRows;
  try {
    for (const statement of WORK_DDL) await local.pg.exec(statement);
    for (const row of found.work) await electionResultFix(local.query, row.race, row.reason, row.kind, row.details);
    workRows = await local.query("SELECT kind,count(*)::int AS rows FROM work GROUP BY kind ORDER BY kind");
    if (Number(workRows.find(row => row.kind === "fix")?.rows ?? 0) !== found.nationalFixRows ||
        Number(workRows.find(row => row.kind === "detect")?.rows ?? 0) !== found.detectiveRows)
      throw new Error("National match counts differ from the work rows actually created on the local test copy");
  } finally { await local.pg.close(); }
  const { work, ...counts } = found;
  const report = { ...counts, copy: metadata, copyReadRequests: reads, productionDatabaseConnections: 0,
    ballotContests: ballots.reduce((n, row) => n + row.contests.length, 0), ballotCandidates: ballots.reduce((n, row) => n + row.candidacies.length, 0),
    notPublishedStates: source.notPublishedStates ?? [], workRows,
    ballotFingerprint: createHash("sha256").update(JSON.stringify(ballots)).digest("hex"),
    work: work.map(({ race, ...row }) => ({ ...row, state: race.state, source: race.sourceId, sourceRaceId: race.sourceRaceId })) };
  if (args.includes("--out")) await writeFile(option("--out"), JSON.stringify(report));
  console.log(JSON.stringify({ ...report, work: undefined }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkNationalResults(process.argv.slice(2));
