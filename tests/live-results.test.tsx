import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BallotNarrowing } from "../components/ballot/ballot-narrowing.tsx";
import { LiveCandidateResult, LiveMeasureBody, LiveMeasureSummary, LiveRaceSummary } from "../components/ballot/live-results.tsx";
import { ResultsFeedContext, type ResultsFeed } from "../components/ballot/results-feed.tsx";

const settled = (facts: Record<string, unknown>): ResultsFeed => ({ status: "settled", facts });
const render = (feed: ResultsFeed, node: React.ReactNode) => renderToStaticMarkup(<ResultsFeedContext.Provider value={feed}>{node}</ResultsFeedContext.Provider>);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const state = (id: string) => ({ id, title: "State House", ocdId: "ocd-division/country:us/state:az", voteFor: 7 });
const source = { sources: [{ name: "MultiState", url: "https://example.test" }], checkedAt: "2026-11-08T12:00:00Z" };

test("the initial ballot carries no results; they arrive after it accepts input", () => {
  const html = renderToStaticMarkup(<BallotNarrowing zip="85001" electionDate="2026-11-03" />);
  assert.ok(html.includes("Narrow this to where you live"));
  assert.ok(!html.includes("data-election-result"));
  assert.equal(render({ status: "loading" }, <LiveRaceSummary contest={state("race")} choices={[{ id: "a", name: "Jordan Example" }]} />), "");
});

test("a multi-seat flip uses the source's count and a winner needs no vote total", () => {
  const feed = settled({ race: { status: "called", flipped: true, gainedByParty: "D", seatsToFill: 7, seatsFlipped: 2, ...source }, a: { won: true, ...source } });
  const html = render(feed, <><LiveRaceSummary contest={state("race")} choices={[{ id: "a", name: "Jordan Example" }]} />
    <LiveCandidateResult candidate={{ id: "a" }} contestId="race" incumbent={false} /></>);
  assert.ok(html.includes("2 seats flipped"));
  assert.ok(!html.includes("7 seats flipped"));
  assert.ok(html.includes('data-outcome="won"'));
});

test("a call is dated on the state's clock and a card with no result says it is working on it", () => {
  const call = text(render(settled({ race: { status: "called", statusChangedAt: "2026-11-04T01:00:00Z", ...source } }),
    <LiveRaceSummary contest={{ ...state("race"), ocdId: "ocd-division/country:us/state:fl", voteFor: 1 }} choices={[]} />));
  assert.match(call, /Called Nov 3/);
  assert.doesNotMatch(call, /MultiState/);
  assert.match(text(render(settled({}), <LiveRaceSummary contest={state("race")} choices={[]} />)), /Want us to get this sooner\?/);
});

test("a measure with no row of its own reads its result from its contest and shows what a vote meant", () => {
  const facts = { prop: { status: "called", outcome: "failed", yesVotes: 1146357, noVotes: 1300000, yesPercent: 46.69, ...source } };
  const measure = { ...state("prop"), voteFor: null, title: "Proposition 144" };
  const html = text(render(settled(facts), <><LiveMeasureSummary measure={measure} /><LiveMeasureBody measure={measure} yes="Yes changes it." no="No keeps it." /></>));
  assert.match(html, /Failed 46\.69% yes/);
  assert.match(html, /Yes 46\.69% 1,146,357 votes/);
  assert.match(html, /A no vote meant · won No keeps it\./);
});
