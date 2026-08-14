import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  formatPartyBreakdown,
  parseResultTally,
  partyBreakdownFor,
} from "../lib/votes/party-breakdown.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

/**
 * Item 3 (wall clock 2026-08-14 second session): the party breakdown on
 * every rendered roll call. The brief's own test: breakdown totals must
 * sum to the roll call's recorded totals — and the denominator is
 * stated, because a join that quietly nulled every vote would render
 * "unavailable" forty times while looking implemented.
 */

const ROOT = join(import.meta.dirname, "..");

const snapshot = JSON.parse(
  readFileSync(join(ROOT, "data", "votes", "votes-snapshot.json"), "utf8"),
) as VotesSnapshot;

const roster = JSON.parse(
  readFileSync(join(ROOT, "lib", "registry", "officeholders-us.json"), "utf8"),
) as { officeholders: { id: string; partyLabel: string | null }[] };

const partyById = new Map(
  roster.officeholders.map((o) => [o.id, o.partyLabel]),
);

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
  // The denominator: measured 40/40 against the committed snapshot when
  // this shipped. A refreshed snapshot may legitimately drop a vote or
  // two (an unmatched member nulls that vote's breakdown honestly), but
  // most votes carrying one is the working state — a majority nulled
  // means the join broke, not the data.
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
