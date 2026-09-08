import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DERIVED_PICK_LINE,
  conflictLine,
  resolvePick,
} from "../lib/ballot/derived-picks.ts";
import {
  applyContestSelection,
  methodFromVoteFor,
  moveOrderedChoice,
} from "../lib/ballot/selection-method.ts";
import type { StoredPick } from "../lib/ballot/picks.ts";

/**
 * M134 — a Yes becomes the pick, and the race stops asking twice.
 *
 * The five rules the row states, one test each, plus the two properties that
 * make the whole thing safe: the derived pick writes nothing anywhere, and it
 * cannot touch a reaction.
 */

const ROOT = join(import.meta.dirname, "..");

function explicit(...ids: string[]): StoredPick {
  return {
    contestId: "c1",
    contestTitle: "A race",
    choiceIds: ids,
    labels: Object.fromEntries(ids.map((id) => [id, id])),
  };
}

test("M134 rule 1 — a Yes on one candidate IS the pick, and the race stops asking", () => {
  const r = resolvePick(null, ["mayes"], 1);
  assert.deepEqual(r.chosen, ["mayes"]);
  assert.equal(r.basis, "DERIVED");
  assert.equal(r.asks, false, "the section must state the pick, not ask again");
  assert.deepEqual(r.conflicting, []);

  // BAL-51's current plurality contract: the newest direct selection replaces
  // the prior one and records exactly what it displaced.
  const replaced = applyContestSelection(
    methodFromVoteFor(1),
    { orderedChoiceIds: ["mayes"] },
    "hamadeh",
  );
  assert.equal(replaced.status, "REPLACED");
  assert.deepEqual(replaced.state.orderedChoiceIds, ["hamadeh"]);
  assert.deepEqual(replaced.displacedChoiceIds, ["mayes"]);
});

test("M134 rule 2 — one-seat newest Yes wins; multi-seat over-limit asks", () => {
  const none = resolvePick(null, [], 1);
  assert.equal(none.asks, true);
  assert.equal(none.basis, "NONE");
  assert.deepEqual(none.chosen, []);

  const newestFirst = resolvePick(null, ["b", "a"], 1);
  assert.equal(newestFirst.asks, false);
  assert.deepEqual(newestFirst.chosen, ["b"], "the newest Yes replaces the prior derived pick");
  assert.deepEqual(newestFirst.conflicting, []);

  // A multi-seat race derives up to what it elects, and no further.
  assert.deepEqual(resolvePick(null, ["a", "b"], 2).chosen, ["a", "b"]);
  assert.equal(resolvePick(null, ["a", "b"], 2).asks, false);
  assert.equal(resolvePick(null, ["a", "b", "c"], 2).asks, true);

  // Vote-for-N never silently throws away an earlier choice at its cap.
  const overLimit = applyContestSelection(
    methodFromVoteFor(2),
    { orderedChoiceIds: ["a", "b"] },
    "c",
  );
  assert.equal(overLimit.status, "LIMIT_REACHED");
  assert.deepEqual(overLimit.state.orderedChoiceIds, ["a", "b"]);
});

test("M134 rule 3 — a recorded pick never flips, and EXPLICIT outranks DERIVED", () => {
  // The reader picked A here, then said they'd vote for B above.
  const r = resolvePick(explicit("a"), ["b"], 1);
  assert.deepEqual(r.chosen, ["a"], "the explicit pick stands");
  assert.equal(r.basis, "EXPLICIT");
  assert.deepEqual(r.conflicting, ["b"], "the disagreement is surfaced");
  assert.equal(r.asks, false);

  // And the sentence says nothing was changed, and asks rather than resolves.
  const line = conflictLine(["A"], ["B"]);
  assert.match(line, /haven't changed anything/);
  assert.match(line, /pick the one you want/);
  assert.ok(!/probably|likely|should|we think/i.test(line));

  // Agreement is not a conflict.
  assert.deepEqual(resolvePick(explicit("a"), ["a"], 1).conflicting, []);

  // Ordered state is ready for a future ranked-choice surface without making
  // plurality positional or adding a ranked UI today.
  const moved = moveOrderedChoice(
    { kind: "RANKED_CHOICE", limit: 3 },
    { orderedChoiceIds: ["a", "b", "c"] },
    "c",
    0,
  );
  assert.equal(moved.status, "MOVED");
  assert.deepEqual(moved.state.orderedChoiceIds, ["c", "a", "b"]);
});

test("M134 rule 4 — resolving a pick cannot alter a reaction: this module writes nothing", () => {
  const source = readFileSync(
    join(ROOT, "lib", "ballot", "derived-picks.ts"),
    "utf8",
  );
  for (const banned of [
    "localStorage",
    "togglePick",
    "clearPick",
    "submitReaction",
    "fetch(",
  ]) {
    assert.ok(
      !source.includes(banned),
      `derived-picks.ts contains "${banned}" — it must decide, never write`,
    );
  }

  // And the control's `clear` touches only the explicit pick file. It is not
  // offered at all on a derived pick, because there it would clear nothing
  // and the reader would read that as their Yes having been removed.
  const control = readFileSync(
    join(ROOT, "components", "ballot", "pick-control.tsx"),
    "utf8",
  );
  assert.match(control, /resolution\.basis === "EXPLICIT" && \(\s*<button/);
  assert.ok(
    !/submitReaction|rememberReaction/.test(control),
    "the pick control must never write a reaction",
  );
  assert.match(control, /data-your-pick-badge/, "the resolved pick needs its green check badge");
  assert.match(control, /transition\.status === "LIMIT_REACHED"/);
  const styles = readFileSync(
    join(ROOT, "components", "ballot", "pick-control.module.css"),
    "utf8",
  );
  assert.match(styles, /background:\s*var\(--vote-yes\)/);
});

test("M134 rule 5 — a measure's Yes/No derives the same way, through the same function", () => {
  // Nothing in `resolvePick` knows what a candidate is. A measure passes its
  // Yes/No option ids and gets the identical behaviour, which is why rule 5
  // needed no second code path.
  assert.deepEqual(resolvePick(null, ["Yes"], 1).chosen, ["Yes"]);
  assert.equal(resolvePick(null, ["Yes"], 1).basis, "DERIVED");
  assert.deepEqual(resolvePick(null, ["No", "Yes"], 1).chosen, ["No"]);
});

test("BAL-51 — tally preserves newest reaction order instead of ballot order", async () => {
  const { tallyPicks } = await import("../lib/ballot/pick-tally.ts");
  const tally = tallyPicks(
    [{
      contestId: "c1",
      contestTitle: "A race",
      voteFor: 1,
      options: [
        { id: "a", label: "A", reactionTargetId: "target-a" },
        { id: "b", label: "B", reactionTargetId: "target-b" },
      ],
    }],
    [],
    new Set(["target-b", "target-a"]),
    {},
  );
  assert.deepEqual(tally.rows[0]?.chosen, ["B"]);
});

test("M134 — a derived pick says where it came from, and stays on the device", () => {
  // A checkmark the reader does not remember making is worse than none.
  assert.match(DERIVED_PICK_LINE, /You said you'd vote for them/);
  assert.match(DERIVED_PICK_LINE, /stays on this phone/);
  assert.match(DERIVED_PICK_LINE, /Change it any time/);

  const control = readFileSync(
    join(ROOT, "components", "ballot", "pick-control.tsx"),
    "utf8",
  );
  // The derived pick is read from the DEVICE's own answer record, never from
  // the server and never from an aggregate — so it can add nothing to what is
  // sold.
  assert.match(control, /getStoredReaction\("CANDIDATE", o\.reactionTargetId\)/);
  assert.ok(
    !/\/api\/reactions/.test(control),
    "the pick control must not read the server for an answer",
  );
  // Both states mark themselves, so a walk can tell which one it got.
  assert.match(control, /data-derived-pick/);
  assert.match(control, /data-pick-conflict/);
});
