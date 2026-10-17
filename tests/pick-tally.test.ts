import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  derivedToSuppress,
  resolveWithSuppression,
  tallyLine,
  tallyPicks,
  type PickableContest,
} from "../lib/ballot/pick-tally.ts";
import type { StoredPick } from "../lib/ballot/picks.ts";

// The tally's denominator is the rendered rows, so it can never describe a ballot other than the one it sits on.

const CANDIDATE_CONTEST: PickableContest = {
  contestId: "az-pima-2026:us-house-6",
  contestTitle: "U.S. House, District 6",
  voteFor: 1,
  options: [
    { id: "cand-a", label: "Ada Alvarez", reactionTargetId: "cand-a" },
    { id: "cand-b", label: "Ben Brooks", reactionTargetId: "cand-b" },
  ],
};

const MEASURE_CONTEST: PickableContest = {
  contestId: "az-2026:prop-100",
  contestTitle: "Proposition 100",
  voteFor: 1,
  // A measure carries no reaction target: reactions attach to provisions, so there is no measure-level Yes.
  options: [
    { id: "YES", label: "Yes" },
    { id: "NO", label: "No" },
  ],
};

const BALLOT = [CANDIDATE_CONTEST, MEASURE_CONTEST];

const explicitMeasureYes: StoredPick = {
  contestId: MEASURE_CONTEST.contestId,
  contestTitle: MEASURE_CONTEST.contestTitle,
  choiceIds: ["YES"],
  labels: { YES: "Yes" },
};

test("THE DEFECT: a derived candidate pick is counted, not only the explicit measure", () => {
  const tally = tallyPicks(BALLOT, [explicitMeasureYes], new Set(["cand-a"]), {});
  assert.equal(tally.pickable, 2);
  assert.equal(tally.picked, 2, "both the measure and the candidate count");
  const kinds = tally.rows.map((r) => `${r.contestId}:${r.basis}`).sort();
  assert.deepEqual(kinds, [
    "az-2026:prop-100:EXPLICIT",
    "az-pima-2026:us-house-6:DERIVED",
  ]);
});

test("the old behaviour is what would fail: explicit-only would have counted 1 of 2", () => {
  // The explicit-file-only reading, recreated as the control.
  const explicitOnly = [explicitMeasureYes].length;
  const tally = tallyPicks(BALLOT, [explicitMeasureYes], new Set(["cand-a"]), {});
  assert.equal(explicitOnly, 1);
  assert.ok(tally.picked > explicitOnly, "the tally must exceed the explicit-only count");
});

test("the denominator is the rendered rows, and it does not move with the picks", () => {
  const none = tallyPicks(BALLOT, [], new Set(), {});
  const some = tallyPicks(BALLOT, [explicitMeasureYes], new Set(["cand-b"]), {});
  assert.equal(none.pickable, 2);
  assert.equal(some.pickable, 2);
  assert.equal(none.picked, 0);
  assert.equal(some.picked, 2);
});

test("a pick stored against a contest this ballot does not carry is listed, never counted", () => {
  const foreign: StoredPick = {
    contestId: "nh-merrimack-2026:state-senate-7",
    contestTitle: "State Senate, District 7",
    choiceIds: ["x"],
    labels: { x: "Someone Else" },
  };
  const tally = tallyPicks(BALLOT, [explicitMeasureYes, foreign], new Set(), {});
  assert.equal(tally.picked, 1);
  assert.equal(tally.pickable, 2);
  assert.equal(tally.foreign.length, 1);
  assert.equal(tally.foreign[0].contestId, foreign.contestId);
});

test("stated N equals rendered rows: rows.length is always picked", () => {
  for (const yes of [new Set<string>(), new Set(["cand-a"]), new Set(["cand-a", "cand-b"])]) {
    const tally = tallyPicks(BALLOT, [explicitMeasureYes], yes, {});
    assert.equal(tally.rows.length, tally.picked);
  }
});

test("Yes to more than the seat elects is not a pick — it asks", () => {
  const tally = tallyPicks(BALLOT, [], new Set(["cand-a", "cand-b"]), {});
  assert.equal(tally.picked, 0, "two Yeses in a one-seat race resolve to no pick");
});

test("THE DEFECT: clearing suppresses the derived pick as well as the explicit one", () => {
  const yes = new Set(["cand-a"]);
  const suppressed = derivedToSuppress(BALLOT, yes, {});
  // clearAllPicks empties the explicit file; the suppression is what is under test.
  const after = tallyPicks(BALLOT, [], yes, suppressed);
  assert.equal(after.picked, 0, "nothing renders as a pick after a clear");
  assert.equal(after.rows.length, 0);
});

test("a clear records the choices cleared, not 'never derive here again'", () => {
  const suppressed = derivedToSuppress(BALLOT, new Set(["cand-a"]), {});
  assert.deepEqual(suppressed[CANDIDATE_CONTEST.contestId], ["cand-a"]);
  // A new Yes after a clear is a new answer and brings the pick back.
  const later = tallyPicks(BALLOT, [], new Set(["cand-b"]), suppressed);
  assert.equal(later.picked, 1);
  assert.equal(later.rows[0].chosen[0], "Ben Brooks");
});

test("REGRESSION: a contest holding BOTH an explicit pick and a Yes clears completely", () => {
  // The state to suppress is the state that exists after the explicit picks are gone.
  const explicitCandidate: StoredPick = {
    contestId: CANDIDATE_CONTEST.contestId,
    contestTitle: CANDIDATE_CONTEST.contestTitle,
    choiceIds: ["cand-a"],
    labels: { "cand-a": "Ada Alvarez" },
  };
  const yes = new Set(["cand-a"]);
  const before = tallyPicks(BALLOT, [explicitCandidate], yes, {});
  assert.equal(before.picked, 1, "one pick before the clear");

  const suppressed = derivedToSuppress(BALLOT, yes, {});
  const after = tallyPicks(BALLOT, [], yes, suppressed);
  assert.equal(after.picked, 0, "the Yes must not surface as a pick after the clear");
});

test("resolveWithSuppression leaves an explicit pick alone", () => {
  const explicitCandidate: StoredPick = {
    contestId: CANDIDATE_CONTEST.contestId,
    contestTitle: CANDIDATE_CONTEST.contestTitle,
    choiceIds: ["cand-a"],
    labels: { "cand-a": "Ada Alvarez" },
  };
  const r = resolveWithSuppression(explicitCandidate, ["cand-a"], 1, ["cand-a"]);
  assert.equal(r.basis, "EXPLICIT");
  assert.deepEqual(r.chosen, ["cand-a"]);
});

test("the count line names both kinds and reconciles with the numbers", () => {
  const tally = tallyPicks(BALLOT, [explicitMeasureYes], new Set(["cand-a"]), {});
  assert.equal(tallyLine(tally), "2 of 2 races and measures on this ballot");
  const one = tallyPicks([MEASURE_CONTEST], [explicitMeasureYes], new Set(), {});
  assert.equal(tallyLine(one), "1 of 1 race or measure on this ballot");
});

test("every PickControl on the ballot page gets its options from the shared builder", () => {
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  const controls = page.match(/<PickControl\b[\s\S]*?\/>/g) ?? [];
  assert.ok(controls.length >= 3, `expected at least 3 PickControl call sites, found ${controls.length}`);
  for (const control of controls) {
    assert.ok(
      /options=\{pickOptionsFor\(/.test(control),
      "a PickControl building its own options can render rows the tally's " +
        "denominator does not know about:\n" +
        control.slice(0, 200),
    );
  }
  assert.ok(
    /options: pickOptionsFor\(/.test(page),
    "the pickable manifest must be built by the same builder",
  );
});

test("the clear reaches the derived picks — the confirm calls derivedToSuppress", () => {
  const card = readFileSync(
    join(process.cwd(), "components", "ballot", "picks-card.tsx"),
    "utf8",
  );
  assert.ok(
    /clearAllPicks\(\s*derivedToSuppress\(/.test(card),
    "clearAllPicks() with no argument clears only the explicit half",
  );
});

test("the picks store still transmits nothing after gaining the suppression field", () => {
  const source = readFileSync(join(process.cwd(), "lib", "ballot", "picks.ts"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(source));
  assert.ok(!/sendBeacon/.test(source));
  assert.ok(!/\/api\//.test(source));
  // One key: the suppression rides inside the picks file rather than becoming a second store.
  const keys = source.match(/localStorage\.(get|set)Item\(([^)]*)\)/g) ?? [];
  for (const k of keys) {
    assert.ok(
      /PICKS_STORAGE_KEY/.test(k),
      `picks.ts touched a storage key other than its own: ${k}`,
    );
  }
});

test("a v1 picks file still reads — an upgrade never discards a stored ballot", () => {
  const source = readFileSync(join(process.cwd(), "lib", "ballot", "picks.ts"), "utf8");
  assert.ok(
    /parsed\.version !== 1 && parsed\.version !== 2/.test(source),
    "the reader must accept v1 as well as v2",
  );
});


test("Not sure overrides both a reaction-derived pick and the shared My picks tally", () => {
  assert.deepEqual(resolveWithSuppression(null, ["candidate"], 1, [], true), { chosen: [], basis: "NONE", conflicting: [], asks: true });
  const tally = tallyPicks([{ contestId: "race", contestTitle: "A race", voteFor: 1,
    options: [{ id: "candidate", label: "Candidate", reactionTargetId: "candidate" }] }], [], new Set(["candidate"]), {}, { race: true });
  assert.equal(tally.picked, 0);
  assert.deepEqual(tally.rows, []);
});
