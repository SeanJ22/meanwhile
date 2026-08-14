import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { VotesSnapshot } from "../lib/votes/types.ts";

/**
 * The votes corpus (5): the committed snapshot against the rules it was
 * built under — counts with denominators, official words only, and the
 * neutrality guard extended to vote records.
 */

const ROOT = join(import.meta.dirname, "..");

function snapshot(): VotesSnapshot {
  return JSON.parse(
    readFileSync(join(ROOT, "data", "votes", "votes-snapshot.json"), "utf8"),
  ) as VotesSnapshot;
}

test("the snapshot states its window, counts, and identifier match", () => {
  const snap = snapshot();
  assert.ok(snap.votes.length > 0, "zero votes is a finding, not a state");
  assert.ok(snap.positions.length > 0);
  assert.ok(snap.window.houseRolls.length > 0);
  assert.ok(snap.window.senateRolls.length > 0);

  // The identifier-set comparison, preserved in the artifact: a join below
  // 95% is broken (cd:0 / NH-designation family), not clipped.
  const m = snap.identifierMatch;
  assert.ok(m.houseTotal > 0 && m.houseMatched / m.houseTotal >= 0.95,
    `house identifier match ${m.houseMatched}/${m.houseTotal}`);
  assert.ok(m.senateTotal > 0 && m.senateMatched / m.senateTotal >= 0.95,
    `senate identifier match ${m.senateMatched}/${m.senateTotal}`);
});

test("every vote leads with official words and links the official record", () => {
  const snap = snapshot();
  for (const vote of snap.votes) {
    assert.ok(vote.title.length > 0, `${vote.id}: a vote must say what it was about`);
    assert.ok(
      vote.titleSource === "BILL_TITLE" || vote.titleSource === "CHAMBER_QUESTION",
      `${vote.id}: the title's source is recorded`,
    );
    assert.match(
      vote.rollCallUrl,
      /^https:\/\/(clerk\.house\.gov|www\.senate\.gov)\//,
      `${vote.id}: the roll call links the chamber's own record`,
    );
    if (vote.billUrl) {
      assert.match(vote.billUrl, /^https:\/\/www\.congress\.gov\//);
    }
    // The result carries the chamber-wide tally, never a party subtotal —
    // the bug this session caught on its first run (roll 264: 76–136 was
    // one party's count; the House total is 76–350).
    assert.ok(vote.result.length > 0);
  }
});

test("the chamber tally, not a party subtotal — roll 264 pins the caught bug", () => {
  const snap = snapshot();
  const roll264 = snap.votes.find(
    (v) => v.chamber === "house" && v.rollNumber === 264,
  );
  // Only assert while the window covers it; the window moves.
  if (roll264) {
    assert.ok(
      roll264.result.includes("76–350"),
      `roll 264 must carry the House total 76–350, got "${roll264.result}"`,
    );
  }
});

test("vote records carry no evaluation — the neutrality guard extends here", () => {
  const forbidden =
    /^(score|rank|rating|match|fit|grade|alignment|recommendation)$/i;
  const snap = snapshot();
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        assert.ok(!forbidden.test(k), `${path}.${k} is an evaluation-shaped key`);
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(snap, "snapshot");
});

test("every position is one of the four recorded states, keyed to a real vote", () => {
  const snap = snapshot();
  const voteIds = new Set(snap.votes.map((v) => v.id));
  const states = new Set(["YES", "NO", "PRESENT", "NOT_VOTING"]);
  for (const p of snap.positions) {
    assert.ok(states.has(p.position), `${p.voteId}: unknown position ${p.position}`);
    assert.ok(voteIds.has(p.voteId), `position for unknown vote ${p.voteId}`);
    assert.match(p.officeholderId, /^congress:[A-Z]\d{6}$/);
  }
});

test("the wired federal members all have positions in the window", () => {
  // The people the four-zip surface renders; the popup's Recent Votes must
  // have something to show for each of them.
  const snap = snapshot();
  const byMember = new Set(snap.positions.map((p) => p.officeholderId));
  for (const id of [
    "congress:C001133",
    "congress:K000377",
    "congress:G000574",
    "congress:G000606",
    "congress:M001246",
    "congress:K000394",
    "congress:B001288",
    "congress:G000604",
    "congress:S001181",
    "congress:H001076",
  ]) {
    assert.ok(byMember.has(id), `${id} has no positions in the snapshot window`);
  }
});

test("the popup legend speaks of their vote, never our approval", () => {
  const source = readFileSync(
    join(ROOT, "components", "map", "popup", "official-popup.tsx"),
    "utf8",
  );
  assert.ok(
    source.includes("Colors state their vote"),
    "the legend must attribute the colors to the member's vote",
  );
  assert.ok(
    source.includes("never our opinion"),
    "the legend must disclaim endorsement",
  );
});
