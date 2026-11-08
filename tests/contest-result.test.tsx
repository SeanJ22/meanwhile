import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateResultLine, MeasureResultBody, MeasureSummary, RaceSummary, WhatHappensNow } from "../components/ballot/contest-result.tsx";
import { flippedParty, formatPercent, shortDate } from "../lib/ballot/results.ts";
import type { Candidacy, Contest, Measure } from "../lib/ballot/types.ts";

const source = { sources: [{ name: "MultiState", url: "https://example.test" }], checkedAt: "2026-11-06T12:00:00.000Z" };
const contest = (result: Contest["result"], voteFor = 1): Contest => ({ id: "c1", electionId: "e", ocdId: "ocd-division/country:us/state:az", divisionVintage: "2026",
  title: "Governor", type: "CANDIDACY", voteFor, termYears: 4, scopeNote: null, provenance: { sourceUrl: "https://example.test", sourceOrg: "x", collectedAt: "", verifiedAt: null }, result });
const person = (id: string, family: string, result?: Candidacy["result"]): Candidacy => ({ id, contestId: "c1", familyName: family, givenName: "A", partyLabel: null, slogan: null,
  incumbent: null, websiteUrl: null, provenance: { sourceUrl: "", sourceOrg: "", collectedAt: "", verifiedAt: null }, result });
const names = new Map([["a", "Ann Able"], ["b", "Bo Baker"]]);
const text = (node: unknown) => renderToStaticMarkup(node as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("a called race shows the winner, the flip and the call date, never who called it", () => {
  const html = text(<RaceSummary contest={contest({ status: "called", percentCounted: 95, statusChangedAt: "2026-11-05T09:00:00Z", flipped: true, gainedByParty: "D", ...source })}
    candidates={[person("a", "Able", { votes: 60, percent: 53.1, won: true, ...source }), person("b", "Baker", { votes: 40, percent: 46.9, ...source })]} names={names} />);
  assert.match(html, /Won Ann Able 53\.1% Flipped/);
  assert.match(html, /Called Nov 5 · about 95% of expected votes counted/);
  assert.doesNotMatch(html, /MultiState|Associated Press/);
});

test("counting shows the leaders; a runoff shows both names; a contest with no result shows the working-on line", () => {
  const counting = text(<RaceSummary contest={contest({ status: "counting", percentCounted: 78, ...source })}
    candidates={[person("a", "Able", { votes: 10, percent: 40, ...source }), person("b", "Baker", { votes: 30, percent: 60, ...source })]} names={names} />);
  assert.match(counting, /Leading so far: Bo Baker/);
  assert.match(counting, /Still counting about 78% counted/);
  const runoff = text(<RaceSummary contest={contest({ status: "runoff", ...source })}
    candidates={[person("a", "Able", { runoff: true, ...source }), person("b", "Baker", { runoff: true, ...source })]} names={names} />);
  assert.match(runoff, /Runoff Ann Able and Bo Baker/);
  assert.match(text(<RaceSummary contest={contest(undefined)} candidates={[person("a", "Able")]} names={names} />), /Want us to get this sooner\?/);
});

test("a Republican flip points right", () => {
  const html = renderToStaticMarkup(<RaceSummary contest={contest({ status: "called", flipped: true, gainedByParty: "R", seatsToFill: 2, ...source }, 2)}
    candidates={[person("a", "Able", { won: true, ...source })]} names={names} />);
  assert.match(html, /data-flip-to="R"/);
  assert.match(html, /Flipped<svg/);
});

test("candidate lines carry percent, votes and the lost-incumbent chip; percent keeps one decimal at 10% and up, two below", () => {
  const html = text(<CandidateResultLine candidate={person("a", "Able", { votes: 181117, percent: 4.256, won: false, ...source })} incumbent lost />);
  assert.match(html, /Incumbent · lost 4\.26% 181,117 votes/);
  assert.equal(formatPercent(53.14), "53.1%");
});

test("a measure shows passed or failed, the yes percent, yes and no rows, and What happens now", () => {
  const measure = { id: "m", contestId: "c1", questionText: "", officialStatement: null, provenance: contest(undefined).provenance,
    result: { yesVotes: 1146357, noVotes: 1300000, yesPercent: 46.69, outcome: "failed", ...source } } as Measure;
  const c = contest({ status: "called", ...source });
  assert.match(text(<MeasureSummary contest={c} measure={measure} />), /Failed 46\.69% yes/);
  const body = text(<MeasureResultBody contest={c} measure={measure} />);
  assert.match(body, /Yes 46\.69% 1,146,357 votes/);
  assert.match(body, /No 53\.31%/);
  const now = text(<WhatHappensNow yes="Yes means a change." no="No keeps things." outcome="failed" closed />);
  assert.match(now, /What happens now/);
  assert.match(now, /A no vote meant · won/);
  assert.doesNotMatch(text(<MeasureSummary contest={contest(undefined)} measure={null} />), /Passed|Failed/);
});

test("dates read on the state's clock and parties map to the flip arrow", () => {
  assert.equal(shortDate("2026-11-05T02:00:00Z", { zone: "America/Phoenix" }), "Nov 4");
  assert.equal(shortDate("2026-12-08", { withYear: true }), "Dec 8, 2026");
  assert.equal(flippedParty({ status: "called", flipped: true, gainedByParty: "Democratic", ...source }), "D");
  assert.equal(flippedParty({ status: "called", flipped: false, gainedByParty: "D", ...source }), null);
});
