import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DERIVED_PICK_LINE,
  conflictLine,
  resolvePick,
} from "../lib/ballot/derived-picks.ts";
import type { StoredPick } from "../lib/ballot/picks.ts";

/**
 * A Yes becomes the pick, and the race stops asking twice. The derived pick writes nothing anywhere and cannot touch
 * a reaction.
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
});

test("M134 rule 2 — it asks when nobody was said Yes to, and when too many were", () => {
  const none = resolvePick(null, [], 1);
  assert.equal(none.asks, true);
  assert.equal(none.basis, "NONE");
  assert.deepEqual(none.chosen, []);

  const many = resolvePick(null, ["a", "b"], 1);
  assert.equal(many.asks, true);
  assert.deepEqual(many.chosen, [], "two Yeses in a one-seat race is not a pick");
  // Every one of them is surfaced. It never picks the first, the newest, or
  // the alphabetically luckiest.
  assert.deepEqual(many.conflicting, ["a", "b"]);

  // A multi-seat race derives up to what it elects, and no further.
  assert.deepEqual(resolvePick(null, ["a", "b"], 2).chosen, ["a", "b"]);
  assert.equal(resolvePick(null, ["a", "b"], 2).asks, false);
  assert.equal(resolvePick(null, ["a", "b", "c"], 2).asks, true);
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
});

test("M134 rule 5 — a measure's Yes/No derives the same way, through the same function", () => {
  // `resolvePick` knows nothing about candidates, so a measure's Yes/No option ids get identical behaviour.
  assert.deepEqual(resolvePick(null, ["Yes"], 1).chosen, ["Yes"]);
  assert.equal(resolvePick(null, ["Yes"], 1).basis, "DERIVED");
  assert.equal(resolvePick(null, ["Yes", "No"], 1).asks, true);
});

test("M134 — a derived pick says where it came from", () => {
  // A checkmark the reader does not remember making is worse than none.
  assert.match(DERIVED_PICK_LINE, /You said you'd vote for them/);
  assert.match(DERIVED_PICK_LINE, /Change it any time/);

  const control = readFileSync(
    join(ROOT, "components", "ballot", "pick-control.tsx"),
    "utf8",
  );
  // The derived pick is read from the device's own answer record, never from the server or an aggregate.
  assert.match(control, /getStoredReaction\("CANDIDATE", o\.reactionTargetId\)/);
  assert.ok(
    !/\/api\/reactions/.test(control),
    "the pick control must not read the server for an answer",
  );
  // Both states mark themselves, so a walk can tell which one it got.
  assert.match(control, /data-derived-pick/);
  assert.match(control, /data-pick-conflict/);
});
