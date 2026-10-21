import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../lib/reference/csv.ts";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const sources = new URL("../data/ballot/ba01-pacific-evidence/", import.meta.url);
const capture = (file: string) => gunzipSync(readFileSync(new URL(file, sources)));
const stateBallot = (state: string): BallotSet => Object.values(JSON.parse(readFileSync(
  new URL(`../data/ballot/2026-general/${state}.json`, import.meta.url), "utf8")).ballots)[0] as BallotSet;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

test("BA-01 Pacific source bytes remain reproducible from their durable official captures", () => {
  const captures = JSON.parse(readFileSync(new URL("captures.json", sources), "utf8"));
  for (const row of captures) {
    assert.equal(createHash("sha256").update(capture(row.file)).digest("hex"), row.rawHash, row.url);
    assert.ok(Number.isFinite(Date.parse(row.retrievedAt)), row.url);
  }
});

test("Hawaii includes every general candidate and preserves the source fields equally", () => {
  const [header, ...values] = parseCsv(capture("hi-candidate-report.csv.gz").toString());
  const rows = values.filter(row => row.some(Boolean)).map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
  assert.equal(rows.length, 415);
  const general = rows.filter(row => row.Status === "In General");
  assert.equal(general.length, 140);
  assert.equal(new Set(general.map(row => row.Contests)).size, 61);
  const ballot = stateBallot("hi");
  for (const row of general) {
    const ticket = row.Contests === "GOVERNOR" || row.Contests === "LIEUTENANT GOVERNOR";
    const contest = ballot.contests.find(c => c.title === (ticket ? "Governor and Lieutenant Governor" : row.Contests));
    assert.ok(contest, row.Contests);
    const candidate = ballot.candidacies.find(c => c.contestId === contest.id &&
      (c.givenName ? `${c.familyName}, ${c.givenName}` : c.familyName).split("\n").includes(row.BallotName));
    assert.ok(candidate, `${row.Contests}: ${row.BallotName}`);
    assert.equal(candidate.partyLabel, row.Party || null);
    if (!ticket) assert.equal(candidate.websiteUrl, row.Website.trim() || null);
  }
  // The governor/LG choices retain both people in each of the two tickets.
  assert.equal(ballot.candidacies.length, 138);
});

test("all twenty Honolulu charter questions retain official text and county scope", () => {
  const ballot = stateBallot("hi");
  const source = readFileSync(new URL("hi-honolulu-charter-questions.txt", sources), "utf8");
  const questions = [...source.matchAll(/Charter Question #(\d+)\s+([\s\S]*?)\s+YES\s+NO/g)];
  assert.equal(questions.length, 20);
  for (const [, number, text] of questions) {
    const contest = ballot.contests.find(c => c.title === `Honolulu Charter Question #${number}`);
    assert.ok(contest);
    assert.equal(contest.ocdId, "ocd-division/country:us/state:hi/county:honolulu");
    assert.equal(ballot.measures.find(m => m.contestId === contest.id)?.questionText, clean(text));
  }
  const honolulu = ballotForDivisions(ballot, ["ocd-division/country:us/state:hi/county:honolulu"]);
  const maui = ballotForDivisions(ballot, ["ocd-division/country:us/state:hi/county:maui"]);
  assert.equal(honolulu.measures.length, 22);
  assert.equal(maui.measures.length, 10);
  assert.equal(ballotForDivisions(ballot, ["ocd-division/country:us/state:hi/county:hawaii"]).measures.length, 3);
  assert.equal(ballotForDivisions(ballot, ["ocd-division/country:us/state:hi/county:kauai"]).measures.length, 3);
});

test("every added Pacific ballot row has an exact source capture timestamp", () => {
  for (const state of ["ak", "hi", "or", "wa"]) {
    const data = JSON.parse(readFileSync(new URL(`../data/ballot/2026-general/${state}.json`, import.meta.url), "utf8"));
    const sources = new Set(data.sourceReceipt.sources.map((s: { finalUrl: string; retrievedAt: string }) => `${s.finalUrl}\n${s.retrievedAt}`));
    const ballot = Object.values(data.ballots)[0] as BallotSet;
    for (const row of [...ballot.contests, ...ballot.candidacies, ...ballot.measures]) {
      if (row.id.startsWith("ba01-")) assert.ok(sources.has(`${row.provenance.sourceUrl}\n${row.provenance.collectedAt}`), row.id);
    }
  }
});

test("King County and Seattle contests follow each electorate without dropping statewide races", () => {
  const ballot = stateBallot("wa");
  const county = ballotForDivisions(ballot, ["ocd-division/country:us/state:wa/county:king"]);
  const seattle = ballotForDivisions(ballot, ["ocd-division/country:us/state:wa/county:king", "ocd-division/country:us/state:wa/place:seattle"]);
  const spokane = ballotForDivisions(ballot, ["ocd-division/country:us/state:wa/county:spokane"]);
  const local = (b: BallotSet) => b.contests.filter(c => c.id.startsWith("ba01-wa-"));
  assert.equal(local(county).length, 3);
  assert.equal(local(seattle).filter(c => c.type === "CANDIDACY").length, 10);
  assert.equal(local(seattle).filter(c => c.type === "MEASURE").length, 1);
  assert.equal(local(spokane).length, 0);
  assert.equal(spokane.contests.filter(c => c.type === "MEASURE").length, 3);
  for (const contest of local(seattle).filter(c => c.type === "CANDIDACY")) {
    const names = ballot.candidacies.filter(c => c.contestId === contest.id);
    assert.ok(names.length);
    for (const candidate of names) {
      assert.equal(candidate.partyLabel, null);
      assert.equal(candidate.websiteUrl, null);
      assert.ok(capture("wa-king-candidates.html.gz").toString().includes(candidate.familyName.replaceAll("&", "&amp;")));
    }
  }
});

test("Oregon keeps all 83 official core contests and preserves multi-seat local elections", () => {
  const ballot = stateBallot("or");
  const source = readFileSync(new URL("or-certified-directive.txt", sources), "utf8");
  const core = [...source.matchAll(/^(US Senator|US Representative, \d+\w* District|Governor|State Senator, \d+\w* District|State Representative, \d+\w* District)\s{2,}Vote for one\s*$/gm)];
  assert.equal(core.length, 83);
  for (const [, title] of core) assert.ok(ballot.contests.some(c => c.title === title), title);
  const lakeOswego = ballot.contests.find(c => c.title === "City of Lake Oswego, Councilor");
  assert.equal(lakeOswego?.voteFor, 4);
  assert.equal(ballot.candidacies.filter(c => c.contestId === lakeOswego?.id).length, 6);
  const county = ballotForDivisions(ballot, ["ocd-division/country:us/state:or/county:multnomah"]);
  assert.equal(county.contests.filter(c => c.id.startsWith("ba01-or-")).length, 6);
  assert.ok(county.candidacies.some(c => c.familyName === "Nicole Morrisey O'Donnell"));
  assert.ok(!county.contests.some(c => c.title.startsWith("City of Gresham")));
});

test("Alaska's official retention list adds every district judge with the stated electorate", () => {
  const source = capture("ak-judicial-council-web-text.txt.gz").toString().replace(/^L\d+: ?/gm, "");
  const judges = [...source.matchAll(/^# 【\d+†([^】]+)】\s*\n(.*?)\n((?:First|Second|Third|Fourth|Thid) Judicial District|Statewide)/gm)];
  assert.equal(judges.length, 21);
  const ballot = stateBallot("ak");
  const districts: Record<string, string> = { First: "1", Second: "2", Third: "3", Thid: "3", Fourth: "4" };
  for (const [, name, court, electorate] of judges) {
    if (electorate === "Statewide") continue;
    const contest = ballot.contests.find(c => c.title === `${court} — Retention of ${name}`);
    assert.equal(contest?.ocdId, `ocd-division/country:us/state:ak/judicial_district:${districts[electorate.split(" ")[0]]}`);
    const candidates = ballot.candidacies.filter(c => c.contestId === contest?.id);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].familyName, name);
    assert.equal(candidates[0].partyLabel, null);
    assert.equal(candidates[0].websiteUrl, null);
    assert.ok(!JSON.stringify(candidates[0]).includes("VOTE YES"));
    assert.ok(!JSON.stringify(candidates[0]).includes("VOTE NO"));
  }
});
