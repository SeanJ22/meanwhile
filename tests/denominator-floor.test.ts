/**
 * **RULING 159 — a counting script fails loudly when its denominator is zero.**
 * (Adopted 2026-08-25, the all-open-board session.)
 *
 * ## What is guarded, and what is deliberately NOT
 *
 * The module itself is guarded by behaviour: an empty population throws, an
 * empty population WITH a stated reason returns a named `COULD_NOT_ASSERT`,
 * and a matched count that exceeds its own population throws — because that
 * means the two numbers were counted over different things, which reads as a
 * healthy ratio and is not one.
 *
 * The repo-wide sweep is guarded by an INVARIANT and a DIRECTION, never by the
 * size of the gap (RULING 116). `tests/denominator-floor-baseline.json` names
 * the 184 counting scripts that did not have a floor on the day the ruling was
 * adopted. **A guard asserting `184` would go red on the day somebody made
 * progress**, which trains a reader to edit the constant rather than look at
 * what changed. So what is asserted is that every counting script is EITHER
 * floored OR on that list, and that the list only ever shrinks.
 *
 * ## The instrument is shown catching the real thing (RULING 110)
 *
 * The plant is the actual defect: a sweep that selects nothing and reports a
 * zero. It must throw, and the message must name the selector — because *"NO
 * CHROMIUM INSTALLED"* about a directory holding a freshly installed Chromium
 * is what sent every reader of RULING 113 to the wrong half of the problem.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EmptyDenominatorError,
  floorLine,
  floored,
  flooredSelector,
} from "../lib/ops/denominator-floor.ts";
import { auditFloors } from "../scripts/floor-audit.mts";

const ROOT = process.cwd();

test("RULING 159: a zero denominator with no stated reason THROWS", () => {
  assert.throws(
    () => floored("offenders", "the sidebar sweep", 0, 0),
    (err: unknown) => {
      assert.ok(err instanceof EmptyDenominatorError);
      assert.match(String(err), /RULING 159/);
      assert.match(String(err), /must be earned/);
      return true;
    },
    "an empty population reported a count instead of refusing",
  );
});

test("RULING 159: an empty population WITH a reason is COULD_NOT_ASSERT, never a pass", () => {
  const c = floored("sittings", "the clerk's page", 0, 0, "the clerk writes 'meets as required' and states no number");
  assert.equal(c.outcome, "COULD_NOT_ASSERT");
  assert.equal(c.denominator, 0);
  assert.match(floorLine(c), /COULD NOT ASSERT/);
  assert.doesNotMatch(
    floorLine(c),
    /^sittings: 0 of 0$/,
    "an unassertable count printed like a measured zero — that is the state this keeps apart",
  );
});

test("RULING 159: a matched count larger than its own population THROWS", () => {
  // The two numbers were counted over different things. A ratio over 1 reads
  // as a very healthy result and is not a result at all.
  assert.throws(() => floored("rows", "a join", 5, 9), EmptyDenominatorError);
});

test("RULING 159: a measured population reports both numbers", () => {
  const c = floored("offenders", "the sidebar sweep", 20, 3);
  assert.equal(c.outcome, "MEASURED");
  assert.equal(floorLine(c), "offenders: 3 of 20");
});

test("RULING 159 — THE PLANT: a selector that matched nothing throws and NAMES the selector", () => {
  /*
   * This is the defect, reproduced. The prior session's capture script guessed
   * three selectors for a panel, hit none, measured an empty list and printed
   * `0 offenders`. Both of the assertions below matter: the throw is what stops
   * the false green, and the selector in the message is what points the reader
   * at the instrument instead of at the surface.
   */
  assert.throws(
    () => flooredSelector("indented rows", ".person-row", [], () => true),
    (err: unknown) => {
      assert.ok(err instanceof EmptyDenominatorError);
      assert.match(String(err), /\.person-row/, "the message does not name the selector that missed");
      assert.match(String(err), /matched NOTHING/);
      return true;
    },
  );

  // And the same call over a population that DID match reports normally, so the
  // floor is not simply refusing everything.
  const ok = flooredSelector("indented rows", ".person-row", [1, 2, 3, 4], (n) => n > 3);
  assert.equal(ok.outcome, "MEASURED");
  assert.equal(ok.matched, 1);
  assert.equal(ok.denominator, 4);
});

test("RULING 159 + RULING 116: every counting script is floored or on the baseline, and the list only shrinks", () => {
  const baseline = JSON.parse(
    readFileSync(join(ROOT, "tests", "denominator-floor-baseline.json"), "utf8"),
  ) as { files: string[]; checked: number };
  const rows = auditFloors(ROOT);

  // A floor on the guard itself. A sweep whose roots stopped resolving would
  // find nothing, and "0 unfloored scripts" is what that looks like.
  assert.ok(
    rows.length >= 100,
    `the audit found only ${rows.length} counting script(s) — it did not reach the tree`,
  );

  const listed = new Set(baseline.files);
  const unfloored = rows.filter((r) => !r.floored).map((r) => r.file);

  // THE INVARIANT: nothing is unaccounted for.
  const strays = unfloored.filter((f) => !listed.has(f));
  assert.deepEqual(
    strays,
    [],
    `these counting scripts report a count with no denominator floor and are not on the baseline: ${strays.join(", ")}`,
  );

  // THE DIRECTION: the baseline shrinks or holds. It never grows.
  assert.ok(
    unfloored.length <= baseline.files.length,
    `unfloored counting scripts went UP: ${unfloored.length} against a baseline of ${baseline.files.length}`,
  );
});
