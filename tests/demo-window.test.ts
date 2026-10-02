import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  STORES_COVERED,
  WALL_DOWN,
  demoSweepVerdict,
} from "../lib/ops/demo-window.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **`T10` — the demo-deletion promise, kept mechanically.** (Adopted
 * 2026-08-24, built with wall-down as the trigger.)
 */

test("nothing deletes while the wall is still up, and that is a REAL answer", () => {
  const v = demoSweepVerdict("2026-08-01", null);
  assert.equal(v.state, "WALL_STILL_UP");
  /*
   * RULING 24: an armed mechanism that has not fired and a mechanism that ran
   * and did nothing must never read the same.
   */
  assert.match(v.reason, /ARMED and has not fired/);
});

test("the wall is still up TODAY — nothing has been deleted", () => {
  assert.equal(WALL_DOWN, null, "arming this is the change that takes the wall down");
  assert.equal(demoSweepVerdict().state, "WALL_STILL_UP");
});

test("an unset WALL_UP means the lower bound is THE BEGINNING, and the verdict says so in words", () => {
  /*
   * RULING 142 — the line in the sand. This test REPLACES
   * "an unbounded window REFUSES rather than deleting from the beginning of
   * time", which asserted the opposite and was correct until this change.
   *
   * The old reasoning was that deleting from the beginning would take real
   * reader rows with it. The ruling removes the premise: nothing collected
   * before the wall comes down is ever sold or shown as signal, so there are no
   * real reader rows below this bound to protect.
   *
   * What is guarded here is the half that could still go wrong — a `from` of
   * `null` meaning *the beginning* must never be confused with a bound somebody
   * failed to establish, which is why the verdict carries a sentence.
   */
  const v = demoSweepVerdict(null, "2026-09-01");
  assert.equal(v.state, "READY");
  assert.equal(v.state === "READY" && v.from, null);
  assert.equal(v.state === "READY" && v.to, "2026-09-01");
  assert.match(v.state === "READY" ? v.lowerBound : "", /beginning/);
  assert.match(v.state === "READY" ? v.lowerBound : "", /RULING 142/);
});

test("a null lower bound is a BOUND, and never reads the same as an unusable window", () => {
  const beginning = demoSweepVerdict(null, "2026-09-01");
  const backwards = demoSweepVerdict("2026-09-10", "2026-09-01");
  assert.notEqual(beginning.state, backwards.state);
  assert.equal(backwards.state, "CANNOT_RUN");
});

test("a backwards window is not a window", () => {
  const v = demoSweepVerdict("2026-09-10", "2026-09-01");
  assert.equal(v.state, "CANNOT_RUN");
});

test("a bounded window with the wall down is READY, and carries its bounds", () => {
  const v = demoSweepVerdict("2026-08-01", "2026-09-01");
  assert.equal(v.state, "READY");
  assert.equal(v.state === "READY" && v.from, "2026-08-01");
  assert.equal(v.state === "READY" && v.to, "2026-09-01");
});

test("the promise covers exactly the two sold stores, named rather than discovered", () => {
  assert.deepEqual([...STORES_COVERED], ["reactions", "search_log"]);
});

test("NO NEW COLUMN was added to either sold store", () => {
  /*
   * The settled collection minimum. The obvious build for T10 is a `demo`
   * column, and it is forbidden — those two stores are sellable precisely
   * because of what they do not contain. The marker is `occurred_at`, which
   * every write path already sets and none can forget.
   */
  const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
  for (const banned of ["demo_window", "isDemo", "is_demo", "demoPeriod", "demo_period"]) {
    assert.ok(!schema.includes(banned), `${banned} must not exist on any store`);
  }
  const deletion = readFileSync(join(ROOT, "lib", "db", "demo-deletion.ts"), "utf8");
  assert.match(deletion, /occurredAt/, "the window predicate is the timestamp");
});

test("deleting requires TWO explicit flags, and report is the default", () => {
  const sweep = readFileSync(join(ROOT, "scripts", "demo-sweep.mts"), "utf8");
  assert.match(sweep, /--execute/);
  assert.match(sweep, /--target=production/);
  assert.match(sweep, /REPORT ONLY/, "a bare run must never delete");
});

test("the deletion re-counts the window afterwards and refuses to report a partial", () => {
  const deletion = readFileSync(join(ROOT, "lib", "db", "demo-deletion.ts"), "utf8");
  /*
   * RULING 100 — a partial that reconciles is still a wrong answer. A driver's
   * reported delete count is what it BELIEVES; a re-count of the same window is
   * the only thing that answers whether the rows are gone.
   */
  assert.match(deletion, /still inside the demo window after the delete/);
  assert.match(deletion, /must not be reported as though it had/);
});

test("the deletion runs only against the production WRITE handle", () => {
  const deletion = readFileSync(join(ROOT, "lib", "db", "demo-deletion.ts"), "utf8");
  assert.match(deletion, /resolveProductionWriteHandle/);
  assert.match(deletion, /WriteHandleRefused/);
});
