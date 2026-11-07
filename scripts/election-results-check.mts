import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { matchElectionResult } from "../lib/election-results/matcher.ts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { BALLOTPEDIA_CONGRESS_URLS, parseBallotpediaCongressSummary, parseBallotpediaResults } from "../lib/election-results/ballotpedia.ts";
import { officeIdentity } from "../lib/officials/office-identity.ts";
import type { BallotSet, Candidacy, Contest, Measure } from "../lib/ballot/types.ts";
import type { ElectionResult, ElectionResultBatch } from "../lib/election-results/types.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import jurisdictions from "../data/reference/us-jurisdiction-labels.json" with { type: "json" };

const run = promisify(execFile);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Public HTTP only. curl honors the managed environment's proxy and never loads saved database keys. */
async function publicText(url: string): Promise<string> {
  const { stdout } = await run("curl", ["--fail-with-body", "--silent", "--show-error", "--location", "--compressed", "--retry", "1", "--max-time", "60", url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function flightRows(html: string): unknown[] {
  const stream = [...html.matchAll(/self\.__next_f\.push\(\[(\d+),("(?:\\.|[^"\\])*")\]\)/g)]
    .filter(match => match[1] === "1").map(match => JSON.parse(match[2]) as string).join("");
  return stream.split("\n").flatMap(line => {
    try { return [JSON.parse(line.slice(line.indexOf(":") + 1)) as unknown]; } catch { return []; }
  });
}

/** A read-only verification snapshot of what the public page actually sends, never the ballot files in git. */
export function publicBallotSnapshot(html: string, zip: string, state: string): BallotSet {
  const choices = new Map<string, Record<string, unknown>>(), measureIds = new Map<string, string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    const row = record(value);
    if (Array.isArray(row.pickable)) for (const choice of row.pickable) {
      const item = record(choice);
      if (typeof item.contestId === "string") choices.set(item.contestId, item);
    }
    const attrs = record(row.attrs), contestId = attrs["data-contest-id"];
    if (typeof contestId === "string") {
      const findMeasure = (value: unknown): void => {
        if (Array.isArray(value)) { for (const child of value) findMeasure(child); return; }
        const item = record(value);
        if (typeof item["data-measure-question"] === "string") measureIds.set(contestId, item["data-measure-question"]);
        for (const child of Object.values(item)) findMeasure(child);
      };
      findMeasure(row.children);
    }
    for (const child of Object.values(row)) walk(child);
  };
  for (const row of flightRows(html)) walk(row);
  if (!choices.size) throw new Error(`Public ballot ${zip} has no readable choice data`);
  const provenance = { sourceUrl: `${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`, sourceOrg: "Meanwhile public ballot", collectedAt: new Date().toISOString(), verifiedAt: null };
  const electionId = `public:${state}:2026-11-03`, contests: Contest[] = [], candidacies: Candidacy[] = [], measures: Measure[] = [];
  for (const [id, choice] of choices) {
    const options = Array.isArray(choice.options) ? choice.options.map(record) : [];
    const yesNo = options.length > 0 && options.every(option => /^(YES|NO)$/i.test(String(option.id)));
    const title = String(choice.contestTitle), type = yesNo ? /\bretention\b/i.test(title) ? "RETENTION" : "MEASURE" : "CANDIDACY";
    const contest: Contest = { id, electionId, ocdId: String(choice.contestOcdId), divisionVintage: "2026", title, type,
      aliases: strings(choice.aliases), voteFor: typeof choice.voteFor === "number" ? choice.voteFor : null,
      termYears: null, scopeNote: null, provenance };
    contests.push(contest);
    if (type === "MEASURE") measures.push({
      // Some public cards expose only the existing contest identity. This snapshot is never sent to a writer.
      id: measureIds.get(id) ?? id, contestId: id, questionText: "", officialStatement: null, provenance,
      officialNumber: /\b(?:Proposition|Prop\.?|Question|Measure|Amendment|Initiative|Referendum)\s+(?:(?:No\.?|Number)\s*)?([A-Za-z]|\d+)\b/i.exec(title)?.[0],
    });
    if (type !== "CANDIDACY") continue;
    for (const option of options) {
      if (typeof option.reactionTargetId !== "string") throw new Error(`Candidate identity missing from public ballot ${zip}: ${id}`);
      const names = String(option.label).split(/\s*\/\s*/), lead = names[0];
      const candidate: Candidacy = { id: option.reactionTargetId, contestId: id, givenName: "", familyName: lead,
        aliases: strings(option.reactionTargetAliases), partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance };
      // The exact joint label is an observed full-name alias; no running-mate identity is invented.
      if (names.length > 1) candidate.aliases = [...candidate.aliases ?? [], `${id}|${String(option.label)}`];
      candidacies.push(candidate);
    }
  }
  return { election: { id: electionId, date: "2026-11-03", name: "2026 general election", state }, contests, candidacies, measures, absences: [] };
}

async function randomZipSample(seed: string, count: number): Promise<{ zip: string; state: string }[]> {
  const places: { zip: string; state: string; order: string }[] = [];
  for (const file of (await readdir("data/derived/zip-divisions")).filter(name => /^\d\d\.json$/.test(name))) {
    const shard = JSON.parse(await readFile(`data/derived/zip-divisions/${file}`, "utf8")) as { divisions: string[]; zips: Record<string, number[]> };
    for (const [zip, indexes] of Object.entries(shard.zips)) {
      const states = [...new Set(indexes.flatMap(index => /\/state:([a-z]{2})(?:\/|$)/.exec(shard.divisions[index])?.[1] ?? []))];
      if (states.length === 1 && states[0] !== "dc") places.push({ zip, state: states[0].toUpperCase(), order: createHash("sha256").update(`${seed}:${zip}`).digest("hex") });
    }
  }
  const states = new Set<string>();
  return places.sort((a, b) => a.order.localeCompare(b.order)).filter(place => {
    if (states.has(place.state)) return false;
    states.add(place.state); return true;
  }).slice(0, count).map(({ zip, state }) => ({ zip, state }));
}

function federalUrl(contest: Contest, state: string): { office: "us_house" | "us_senate"; districtHint?: string; url: string } | null {
  const office = officeIdentity(contest.title, contest.ocdId), name = jurisdictions.jurisdictions.find(row => row.postal === state)?.name;
  if (!name) throw new Error(`State label missing for ${state}`);
  if (office === "us_senator") return { office: "us_senate", url: `https://ballotpedia.org/United_States_Senate_election_in_${name.replace(/ /g, "_")},_2026` };
  if (office !== "us_representative") return null;
  const district = /\/cd:(\d+)(?:\/|$)/.exec(contest.ocdId)?.[1] ?? (["AK", "DE", "ND", "SD", "VT", "WY"].includes(state) ? "0" : undefined);
  if (district === undefined) throw new Error(`Congressional district missing for ${contest.id}`);
  const n = Number(district), suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  const seat = n === 0 ? "At-large" : `${n}${suffix}`;
  const possessive = `${name.replace(/ /g, "_")}%27${name.endsWith("s") ? "" : "s"}`;
  return { office: "us_house", districtHint: district, url: `https://ballotpedia.org/${possessive}_${seat}_Congressional_District_election,_2026` };
}

async function federalBatch(contest: Contest, state: string, checkedAt: string): Promise<ElectionResultBatch | null> {
  const race = federalUrl(contest, state);
  if (!race) return null;
  const html = await publicText(race.url);
  try { return parseBallotpediaResults(html, { ...race, state }, checkedAt); }
  catch (error) {
    if (race.office !== "us_senate" || !(error instanceof Error) || !/current general-election table/.test(error.message)) throw error;
    const url = race.url.replace("Senate_election_in_", "Senate_special_election_in_");
    return parseBallotpediaResults(await publicText(url), { ...race, state, url }, checkedAt);
  }
}

async function verifyOnCopy(copy: FactDb & { query: Query }, ballot: BallotSet, batches: readonly ElectionResultBatch[], at: string) {
  const { publishElectionResultBatch, ensureOpenElectionResults } = await import("../lib/election-results/publisher.ts");
  const { withBallotResultFacts } = await import("../lib/ballot/election-results.ts");
  const { ensureEntity } = await import("../lib/facts/entities.ts");
  // The public page does not send every question row's internal id. A local-only question id exercises its reader field independently.
  const localQuestionIds = ballot.measures.filter(measure => measure.id === measure.contestId).length;
  ballot = { ...ballot, measures: ballot.measures.map(measure => measure.id === measure.contestId
    ? { ...measure, id: `${measure.contestId}#copy-question` } : measure) };
  const state = ballot.election.state, covered = new Set<string>();
  for (const id of new Set(["ocd-division/country:us", `ocd-division/country:us/state:${state.toLowerCase()}`, ...ballot.contests.map(row => row.ocdId)]))
    await ensureEntity(copy.query, { id, kind: "place", name: id, state: id === "ocd-division/country:us" ? null : state, parentId: null });
  let calls = 0;
  const counted = (query: Query): Query => async (text, params) => { calls++; return query(text, params); };
  const db: FactDb = { transaction: work => copy.transaction(query => work(counted(query))) };
  let exactComparisons = 0, published = 0, sourceFixes = 0, unchangedSqlCalls = 0;
  for (const batch of batches) {
    const input = { db, query: counted(copy.query), ballots: [ballot], batch, state, now: new Date(at), purge: async () => ({ purged: true }) };
    const first = await publishElectionResultBatch(input);
    published += first.counts.published;
    sourceFixes += first.counts.unmatched + first.counts.ambiguous;
    const before = calls;
    await publishElectionResultBatch({ ...input, prior: first.progress, now: new Date(Date.parse(at) + 6 * 3_600_000) });
    unchangedSqlCalls += calls - before;
  }
  const rows = await copy.query("SELECT entity_id,value,checked_at FROM checked_fact WHERE status='live' AND field IN ('election_result','election_summary') AND entity_id=ANY($1::text[])",
    [[...ballot.contests, ...ballot.candidacies, ...ballot.measures].map(row => row.id).concat(`ocd-division/country:us/state:${state.toLowerCase()}`, "ocd-division/country:us")]);
  const facts = Object.fromEntries(rows.map(row => [String(row.entity_id), { ...record(row.value), checkedAt: new Date(row.checked_at as string).toISOString() }]));
  const projected = withBallotResultFacts({ ballots: { sample: ballot } }, facts).ballots.sample;
  const compare = (actual: unknown, expected: Record<string, unknown>, subject: string) => {
    const values = record(actual);
    for (const [field, value] of Object.entries(expected)) { assert.deepEqual(values[field], value, `${state} ${subject} ${field}`); exactComparisons++; }
  };
  for (const result of batches.flatMap(batch => batch.races.filter(race => race.state === state))) {
    const match = matchElectionResult(result, ballot);
    if (match.kind !== "matched") continue;
    covered.add(match.contest.id);
    compare(projected.contests.find(row => row.id === match.contest.id)?.result,
      { status: result.status, percentCounted: result.percentCounted ?? null, statusChangedAt: result.statusChangedAt ?? null,
        seatsToFill: result.seatsToFill ?? match.contest.voteFor, flipped: result.flipped ?? null,
        gainedByParty: result.gainedByParty ?? null, incumbentLost: result.incumbentLost ?? null }, match.contest.id);
    for (const row of match.candidates) {
      const source = result.candidates[row.resultIndex];
      compare(projected.candidacies.find(candidate => candidate.id === row.candidacy.id)?.result,
        { votes: source.votes ?? null, percent: source.percent ?? null, won: source.won ?? null, runoff: source.runoff ?? null }, row.candidacy.id);
    }
    if (result.measure && match.measure) compare(projected.measures.find(row => row.id === match.measure!.id)?.result,
      { yesVotes: result.measure.yesVotes ?? null, noVotes: result.measure.noVotes ?? null, yesPercent: result.measure.yesPercent ?? null,
        outcome: result.measure.outcome }, match.measure.id);
  }
  for (const summary of batches.flatMap(batch => batch.summaries.filter(summary => summary.state === state)))
    compare(projected.results?.state, { chambers: summary.chambers, governor: summary.governor, statewideOfficesFlipped: summary.statewideOfficesFlipped }, `${state} summary`);
  await ensureOpenElectionResults(copy.query, [ballot], covered);
  const [work] = await copy.query("SELECT count(*) FILTER(WHERE kind='fix')::int AS fixes,count(*) FILTER(WHERE kind='detect')::int AS detectives,count(*) FILTER(WHERE kind='hunt')::int AS standing FROM work WHERE state=$1", [state]);
  assert.equal(unchangedSqlCalls, 0, "Unchanged source rechecks must issue no SQL");
  return { exactComparisons, localQuestionIds, publishedFacts: published, unmatchedSourceRaces: sourceFixes, fixRows: Number(work?.fixes),
    detectiveRows: Number(work?.detectives), standingRows: Number(work?.standing), unchangedRecheckSqlCalls: unchangedSqlCalls };
}

async function check() {
  for (const name of ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL_READONLY", "WTP_PRODUCTION_DATABASE_URL_READONLY"]) delete process.env[name];
  const args = process.argv.slice(2), seed = args[args.indexOf("--seed") + 1] && args.includes("--seed") ? args[args.indexOf("--seed") + 1] : randomBytes(16).toString("hex");
  const sample = await randomZipSample(seed, 10), checkedAt = new Date().toISOString();
  if (args.includes("--nation-only")) { await checkCongress(sample, checkedAt); return; }
  const raw = await publicText("https://multistate.us/elections/data/live_results_general_2026.json");
  const source = parseMultiStateResults(raw, checkedAt);
  const { factDb } = await import("../tests/helpers/fact-db.ts");
  const { WORK_DDL } = await import("../lib/core/work.ts");
  const copy = await factDb();
  for (const statement of WORK_DDL) await copy.pg.exec(statement);
  console.log(JSON.stringify({ seed, checkedAt, sample, multiStateRaces: source.races.length }));
  const reports = [];
  try { for (const place of sample) {
    const start = Date.now(), page = await publicText(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${place.zip}`);
    const ballot = publicBallotSnapshot(page, place.zip, place.state);
    const batches = [source], matches: { result: ElectionResult; contestId: string; candidates: number; missingCandidates: number }[] = [], failures: { contestId: string; detail: string }[] = [];
    for (const result of source.races.filter(race => race.state === place.state)) {
      const match = matchElectionResult(result, ballot);
      if (match.kind === "matched") matches.push({ result, contestId: match.contest.id, candidates: match.candidates.length,
        missingCandidates: match.unmatchedCandidates.length + match.ambiguousCandidates.length });
    }
    for (const contest of ballot.contests) {
      try {
        const batch = await federalBatch(contest, place.state, checkedAt);
        if (!batch) continue;
        batches.push(batch);
        const result = batch.races[0], match = matchElectionResult(result, ballot);
        if (match.kind === "matched" && match.contest.id === contest.id) matches.push({ result, contestId: contest.id,
          candidates: match.candidates.length, missingCandidates: match.unmatchedCandidates.length + match.ambiguousCandidates.length });
        else failures.push({ contestId: contest.id, detail: `Federal source identity ${match.kind}` });
      } catch (error) { failures.push({ contestId: contest.id, detail: error instanceof Error ? error.message : String(error) }); }
    }
    const matched = new Set(matches.map(match => match.contestId));
    const owed = ballot.contests.filter(contest => contest.type !== "RETENTION" &&
      (/\/(?:sldl|sldu|cd):/.test(contest.ocdId) || /\/state:[a-z]{2}$/.test(contest.ocdId)));
    const verified = await verifyOnCopy(copy, ballot, batches, checkedAt);
    const report = { ...place, ...verified, pageBytes: Buffer.byteLength(page), elapsedMs: Date.now() - start, servedContests: ballot.contests.length,
      owedStateAndCongressContests: owed.length, matchedRaces: matches.length, matchedCandidates: matches.reduce((n, match) => n + match.candidates, 0),
      candidateFixes: matches.reduce((n, match) => n + match.missingCandidates, 0),
      unmatchedContests: owed.filter(contest => !matched.has(contest.id)).map(contest => ({ id: contest.id, title: contest.title })),
      failures, results: matches.map(({ result, contestId, candidates }) => ({ contestId, sourceRaceId: result.sourceRaceId, source: result.sourceName,
        office: result.office, status: result.status, candidates, measure: result.measure, values: result.candidates.map(({ name, votes, percent, won, runoff }) => ({ name, votes, percent, won, runoff })) })) };
    reports.push(report); console.log(JSON.stringify(report));
  } } finally { await copy.pg.close(); }
  const total = { states: reports.length, matchedRaces: reports.reduce((n, row) => n + row.matchedRaces, 0),
    matchedCandidates: reports.reduce((n, row) => n + row.matchedCandidates, 0), candidateFixes: reports.reduce((n, row) => n + row.candidateFixes, 0),
    unmatchedContests: reports.reduce((n, row) => n + row.unmatchedContests.length, 0), sourceFailures: reports.reduce((n, row) => n + row.failures.length, 0),
    exactFieldComparisons: reports.reduce((n, row) => n + row.exactComparisons, 0), publishedCopyFacts: reports.reduce((n, row) => n + row.publishedFacts, 0),
    unchangedRecheckSqlCalls: reports.reduce((n, row) => n + row.unchangedRecheckSqlCalls, 0),
    productionDatabaseConnections: 0, publication: "Live public ballots and sources published through the Slide on a disposable local copy; reader fields compared exactly" };
  console.log(JSON.stringify(total));
}

async function checkCongress(sample: readonly { zip: string; state: string }[], checkedAt: string) {
  const { factDb } = await import("../tests/helpers/fact-db.ts");
  const { publishElectionResultBatch } = await import("../lib/election-results/publisher.ts");
  const { ensureEntity } = await import("../lib/facts/entities.ts");
  const { withBallotResultFacts } = await import("../lib/ballot/election-results.ts");
  const copy = await factDb();
  try {
    await ensureEntity(copy.query, { id: "ocd-division/country:us", kind: "place", name: "United States", state: null, parentId: null });
    const expected = [];
    let unchangedRecheckSqlCalls = 0;
    for (const office of ["us_senate", "us_house"] as const) {
      const batch = parseBallotpediaCongressSummary(await publicText(BALLOTPEDIA_CONGRESS_URLS[office]), office, checkedAt);
      let calls = 0;
      const count = (query: Query): Query => async (text, params) => { calls++; return query(text, params); };
      const input = { db: { transaction: <T,>(work: (query: Query) => Promise<T>) => copy.transaction(query => work(count(query))) },
        query: count(copy.query), batch, ballots: [], state: "US", now: new Date(checkedAt), purge: async () => ({ purged: true }) };
      const result = await publishElectionResultBatch(input), before = calls;
      await publishElectionResultBatch({ ...input, prior: result.progress });
      unchangedRecheckSqlCalls += calls - before;
      const summary = batch.summaries[0];
      expected.push(...summary.chambers.map(chamber => ({ ...chamber, source: summary.source,
        creditedSources: summary.creditedSources, checkedAt: summary.checkedAt })));
    }
    const held = await copy.query("SELECT entity_id,field,value,checked_at FROM checked_fact WHERE status='live' AND field LIKE 'election_summary:%'");
    const facts = Object.fromEntries(held.map(row => [`${row.entity_id}#${row.field}`, { ...record(row.value), checkedAt: new Date(row.checked_at as string).toISOString() }]));
    for (const place of sample) {
      const ballot: BallotSet = { election: { id: `public:${place.state}:2026-11-03`, date: "2026-11-03", name: "General election", state: place.state },
        contests: [], candidacies: [], measures: [], absences: [] };
      const projected = withBallotResultFacts({ ballots: { sample: ballot } }, facts);
      assert.deepEqual(projected.ballots.sample.results?.nation?.chambers, expected, `${place.state} Congress summary`);
    }
    assert.equal(unchangedRecheckSqlCalls, 0);
    console.log(JSON.stringify({ states: sample.length, chambers: expected, exactChamberComparisons: sample.length * expected.length,
      unchangedRecheckSqlCalls, productionDatabaseConnections: 0 }));
  } finally { await copy.pg.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await check();
