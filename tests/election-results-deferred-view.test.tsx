import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BallotNarrowing } from "../components/ballot/ballot-narrowing.tsx";
import { ResultView } from "../components/ballot/deferred-result-views.tsx";
import type { BallotElectionSummary } from "../lib/ballot/election-results.ts";

const summary = (state: string, seatsFlipped: number | undefined, incumbentsLost: number | undefined): BallotElectionSummary => ({
  state, checkedAt: "2026-11-08T12:00:00Z", source: { name: "Test publisher", url: "https://example.test/results" }, creditedSources: [],
  chambers: [{ name: "State House", seatsBefore: { D: 10, R: 12 }, seatsNow: { D: 12, R: 10 }, stillCounting: 0,
    controlBefore: "R", controlNow: "D", ...(seatsFlipped === undefined ? {} : { seatsFlipped }) }],
  governor: { before: "R", now: "D", name: "Jordan Example" }, statewideOfficesFlipped: [],
  ...(incumbentsLost === undefined ? {} : { incumbentsLost }),
});

test("initial ballot keeps its original markup while results remain deferred", () => {
  const html = renderToStaticMarkup(<BallotNarrowing zip="85001" electionDate="2026-11-03" />);
  assert.ok(html.includes("Narrow this to where you live"));
  assert.ok(!html.includes("data-election-result"));
});

test("late summaries preserve exact numeric flips, zero losses and the governor name", () => {
  for (const [state, flipped, lost] of [["AZ", 7, 0], ["TX", 0, 7]] as const) {
    const html = renderToStaticMarkup(<ResultView kind="summary" feed={{ available: true, state,
      facts: { [`ocd-division/country:us/state:${state.toLowerCase()}`]: summary(state, flipped, lost) } }} />);
    assert.ok(html.includes(`Seats that flipped: ${flipped}.`));
    assert.ok(html.includes(`Incumbents who lost: ${lost}.`));
    assert.ok(html.includes("Governor (Jordan Example)"));
  }
  const unknown = renderToStaticMarkup(<ResultView kind="summary" feed={{ available: true, state: "AZ",
    facts: { "ocd-division/country:us/state:az": summary("AZ", undefined, undefined) } }} />);
  assert.ok(!unknown.includes("Seats that flipped:"));
  assert.ok(!unknown.includes("Incumbents who lost:"));
  const incomplete = summary("AZ", undefined, undefined);
  incomplete.chambers[0].seatsBefore = {};
  const missing = renderToStaticMarkup(<ResultView kind="summary" feed={{ available: true, state: "AZ",
    facts: { "ocd-division/country:us/state:az": incomplete } }} />);
  assert.ok(missing.includes("Not reported"));
  assert.ok(missing.includes("Not applicable"));
  assert.ok(!missing.includes("—"));
});

test("partial multi-seat flips use the source count and a winner needs no vote total", () => {
  const facts = { race: { status: "called", flipped: true, gainedByParty: "D", seatsToFill: 7, seatsFlipped: 2 }, candidate: { won: true } };
  const html = renderToStaticMarkup(<><ResultView kind="contest" id="race" title="State House" ocdId="ocd-division/country:us/state:az"
    voteFor={7} choices={[{ id: "candidate", name: "Jordan Example" }]} feed={{ available: true, state: "AZ", facts }} />
    <ResultView kind="candidate" id="candidate" contestId="race" incumbent={false} feed={{ available: true, state: "AZ", facts }} /></>);
  assert.ok(html.includes("2 seats flipped"));
  assert.ok(!html.includes("7 seats flipped"));
  assert.ok(html.includes('data-outcome="won"'));
});

test("late results name Congress for readers and date a call in the state's clock", () => {
  const nation = { ...summary("US", 0, 7), chambers: [{ ...summary("US", 0, 7).chambers[0], name: "us_senate" }] };
  const html = renderToStaticMarkup(<ResultView kind="summary" feed={{ available: true, state: "FL", facts: { "ocd-division/country:us": nation } }} />);
  assert.ok(html.includes("U.S. Senate"));
  assert.ok(!html.includes("us_senate"));
  const call = renderToStaticMarkup(<ResultView kind="contest" id="race" title="Governor" ocdId="ocd-division/country:us/state:fl" voteFor={1}
    choices={[]} feed={{ available: true, state: "FL", facts: { race: { status: "called", statusChangedAt: "2026-11-04T01:00:00Z" } } }} />);
  assert.ok(call.includes("Nov 3"));
  assert.ok(!call.includes("Nov 4"));
});
