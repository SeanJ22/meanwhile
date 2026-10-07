/**
 * Whose gap an absent agenda is, on the surfaces that render it: a null `agendaUrl` is never
 * rendered as "No agenda posted yet".
 */

import assert from "node:assert/strict";
import test from "node:test";

import { agendaSentenceFor } from "../lib/ask/agenda-sentence.ts";

const OBSERVED_AT = "2026-08-31T09:00:00.000Z";
const NOW = Date.parse("2026-08-31T12:00:00.000Z");

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "mtg-1",
    agendaUrl: null,
    agendaSlotObservedEmpty: true,
    provenance: {
      sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?ID=1",
      sourceOrg: "Pima County Clerk of the Board",
      collectedAt: OBSERVED_AT,
    },
    ...over,
  };
}

test("SEEDED SWEEP-01: a null agenda link with NO observation is OUR gap, not theirs", () => {
  const said = agendaSentenceFor(
    meeting({ agendaSlotObservedEmpty: undefined }),
    NOW,
  );
  assert.equal(said.whose, "OURS");
  assert.match(said.sentence, /We haven't recorded/i);
  assert.doesNotMatch(
    said.sentence,
    /posted|publish/i,
    "this is the defect exactly: 'No agenda posted yet' is a claim about a clerk, produced from " +
      "a measurement of our own store",
  );
});

test("ASK-18: a FRESH first-party observation of an empty slot is THEIR gap, and it names them", () => {
  const said = agendaSentenceFor(meeting(), NOW);
  assert.equal(said.whose, "THEIRS");
  assert.match(said.sentence, /Pima County Clerk of the Board/);
  assert.match(said.sentence, /hadn't posted/);
  assert.match(said.sentence, /when we checked on August 31/);
  assert.equal(said.observation?.provenance, "FIRST_PARTY_PUBLISHER");
});

test("SEEDED ASK-18: an EXPIRED observation falls back to OUR gap", () => {
  const wellPast = Date.parse("2026-09-03T12:00:00.000Z");
  const said = agendaSentenceFor(meeting(), wellPast);
  assert.equal(said.whose, "OURS");
  assert.equal(said.observation, null);
});

test("SEEDED ASK-18: an AGGREGATOR's missing link never becomes a fact about the body", () => {
  const said = agendaSentenceFor(
    meeting({
      provenance: {
        sourceUrl: "https://aggregator.example/copy",
        sourceOrg: "Some Aggregator",
        collectedAt: OBSERVED_AT,
        secondHand: true,
      },
    }),
    NOW,
  );
  assert.equal(said.whose, "OURS");
});

test("SEEDED ASK-18: a CARRIED-FORWARD row was not retrieved, so it observes nothing", () => {
  const said = agendaSentenceFor(meeting({ carried: { from: "an earlier run" } }), NOW);
  assert.equal(
    said.whose,
    "OURS",
    "a carried row's collectedAt is not when this listing was read, so it cannot date an " +
      "observation",
  );
});

test("SEEDED ASK-18: an unnamed source page is unverifiable, so it earns no THEIRS", () => {
  const said = agendaSentenceFor(
    meeting({
      provenance: { sourceUrl: null, sourceOrg: "Pima County", collectedAt: OBSERVED_AT },
    }),
    NOW,
  );
  assert.equal(said.whose, "OURS");
});

test("W2: an agenda we HOLD is not an absence to observe at all", () => {
  const said = agendaSentenceFor(
    meeting({ agendaUrl: "https://pima.legistar.com/View.ashx?M=A&ID=1" }),
    NOW,
  );
  assert.equal(said.whose, "OURS");
  assert.equal(said.observation, null);
});

test("SWEEP-01: BOTH surfaces get the identical sentence from the identical input", () => {
  // One decider: same input, same sentence.
  const input = meeting();
  const a = agendaSentenceFor(input, NOW);
  const b = agendaSentenceFor({ ...input }, NOW);
  assert.equal(a.sentence, b.sentence);
  assert.equal(a.whose, b.whose);
});
