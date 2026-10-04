import assert from "node:assert/strict";
import test from "node:test";

import { departedFederalVoteSeat } from "../lib/votes/departed-seat.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

const snapshot = {
  generatedAt: "2026-10-01T00:00:00Z", congress: 119, session: 2,
  window: { houseRolls: [1], senateRolls: [] },
  identifierMatch: { houseMatched: 1, houseTotal: 1, senateMatched: 0, senateTotal: 0 },
  votes: [{
    id: "house:119-2:1", chamber: "house", congress: 119, session: 2, rollNumber: 1, date: "2026-06-13",
    title: "A bill", titleSource: "BILL_TITLE", question: "On Passage", legisNum: "H.R. 1", result: "Passed 2–1",
    billUrl: null, rollCallUrl: "https://clerk.example/1", retrievedAt: "2026-06-14",
  }],
  positions: [{ officeholderId: "congress:GONE1", voteId: "house:119-2:1", position: "YES" }],
} as VotesSnapshot;

test("a member absent from the current roster still has a seat derived from their recorded votes", () => {
  const seat = departedFederalVoteSeat("congress:GONE1", "Former Member", snapshot);
  assert.equal(seat?.officeTitle, "U.S. Representative");
  assert.equal(seat?.rosterScope, "us");
  assert.equal(seat?.chamber, "house");
  assert.equal(seat?.sourceUrl, "https://clerk.example/1");
});

test("an id the vote store never recorded gets no seat", () => {
  assert.equal(departedFederalVoteSeat("congress:NOBODY", "Nobody", snapshot), null);
});
