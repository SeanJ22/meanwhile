import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPartyBreakdown,
  parseResultTally,
  partyBreakdownFor,
} from "../lib/votes/party-breakdown.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

// Breakdown totals must sum to the roll call's recorded totals.

const position = (voteId: string, officeholderId: string, vote: "YES" | "NO") =>
  ({ voteId, officeholderId, position: vote });

const snapshot = {
  votes: [
    { id: "house:119-2:1", result: "Passed 3–2" },
    { id: "house:119-2:2", result: "Failed 1–4" },
  ],
  positions: [
    position("house:119-2:1", "m1", "YES"),
    position("house:119-2:1", "m2", "YES"),
    position("house:119-2:1", "m3", "YES"),
    position("house:119-2:1", "m4", "NO"),
    position("house:119-2:1", "m5", "NO"),
    position("house:119-2:2", "m1", "YES"),
    position("house:119-2:2", "m2", "NO"),
    position("house:119-2:2", "m3", "NO"),
    position("house:119-2:2", "m4", "NO"),
    position("house:119-2:2", "m5", "NO"),
  ],
} as unknown as VotesSnapshot;

const partyById = new Map<string, string | null>([
  ["m1", "Democratic"],
  ["m2", "Democratic"],
  ["m3", "Republican"],
  ["m4", "Republican"],
  ["m5", "Independent"],
]);

test("every breakdown sums exactly to the chamber's recorded tally", () => {
  let withBreakdown = 0;
  for (const vote of snapshot.votes) {
    const breakdown = partyBreakdownFor(
      vote.id,
      vote.result,
      snapshot.positions,
      partyById,
    );
    if (!breakdown) continue;
    withBreakdown++;
    const expected = parseResultTally(vote.result);
    assert.ok(expected, `${vote.id}: breakdown rendered without a tally`);
    const yes = breakdown.reduce((n, t) => n + t.yes, 0);
    const no = breakdown.reduce((n, t) => n + t.no, 0);
    assert.equal(yes, expected.yes, `${vote.id}: yes sum ${yes} ≠ ${expected.yes}`);
    assert.equal(no, expected.no, `${vote.id}: no sum ${no} ≠ ${expected.no}`);
  }
  // A majority of votes without a breakdown means the join broke, not the data.
  assert.ok(
    withBreakdown >= Math.ceil(snapshot.votes.length / 2),
    `only ${withBreakdown}/${snapshot.votes.length} votes carry a breakdown — the join is broken`,
  );
});

test("a tally that doesn't sum is refused, never rendered", () => {
  const vote = snapshot.votes[0];
  // Sabotage: strip one member's party so the sum can't close.
  const holed = new Map(partyById);
  const aVoter = snapshot.positions.find(
    (p) => p.voteId === vote.id && (p.position === "YES" || p.position === "NO"),
  );
  assert.ok(aVoter);
  holed.set(aVoter.officeholderId, null);
  assert.equal(
    partyBreakdownFor(vote.id, vote.result, snapshot.positions, holed),
    null,
  );
});

test("a result with no tally (voice-vote shape) is refused honestly", () => {
  assert.equal(
    partyBreakdownFor("x", "Agreed to by voice vote", snapshot.positions, partyById),
    null,
  );
});

test("the rendered sentence is numbers only — no characterization", () => {
  const vote = snapshot.votes.find((v) =>
    partyBreakdownFor(v.id, v.result, snapshot.positions, partyById),
  );
  assert.ok(vote);
  const breakdown = partyBreakdownFor(
    vote.id,
    vote.result,
    snapshot.positions,
    partyById,
  );
  assert.ok(breakdown);
  const sentence = formatPartyBreakdown(breakdown);
  assert.ok(/\d+ for, \d+ against/.test(sentence));
  for (const banned of [
    "party-line",
    "party line",
    "crossed the aisle",
    "bipartisan",
    "unanimous",
  ]) {
    assert.ok(
      !sentence.toLowerCase().includes(banned),
      `characterization "${banned}" in the breakdown`,
    );
  }
  // Alphabetical order — a neutral criterion.
  const parties = breakdown.map((t) => t.party);
  assert.deepEqual(parties, [...parties].sort());
});
