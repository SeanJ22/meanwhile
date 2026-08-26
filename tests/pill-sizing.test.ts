/**
 * **BAL-12 (2026-08-25) — pill sizing uniformity, with its denominator.**
 *
 * Reported as a three-way split (RULING 105), because a bare count of
 * differences cannot tell a decision from a drift. Only the third number is a
 * defect, and it is the one asserted at zero.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REFERENCE_SELECTOR,
  pillCensus,
  splitCensus,
  type PillReasons,
} from "../scripts/pill-census.mts";

const ROOT = process.cwd();
const css = () => readFileSync(join(ROOT, "app", "globals.css"), "utf8");
const reasons = () =>
  JSON.parse(readFileSync(join(ROOT, "tests", "pill-sizing-reasons.json"), "utf8")) as PillReasons;

test("BAL-12: the census reaches the stylesheet at all", () => {
  // The floor (RULING 159). A parse that found nothing would report perfect
  // uniformity, which is the failure this instrument exists to avoid.
  const census = pillCensus(css());
  assert.ok(census.measured.length >= 20, `only ${census.measured.length} pill rule(s) were found`);
  assert.ok(census.reference, `the reference ${REFERENCE_SELECTOR} is not in the stylesheet`);
});

test("BAL-12: every sizing difference from the reference has a STATED REASON", () => {
  const split = splitCensus(pillCensus(css()), reasons());
  assert.deepEqual(
    split.unexcused.map((d) => `${d.selector} ${d.prop}: ${d.value} (reference ${d.reference})`),
    [],
    "a pill differs from the voting-pill reference and nobody wrote down why",
  );
});

test("BAL-12: a reason for a difference that no longer exists is removed", () => {
  /*
   * The other direction, and the one nobody watches. A recorded reason for a
   * difference that has since been normalised is a note explaining something
   * that is not there — it reads as a live decision and is a fossil.
   */
  const split = splitCensus(pillCensus(css()), reasons());
  assert.deepEqual(split.stale, [], "these reasons describe differences that no longer exist");
});

test("BAL-12: the TAG pills carry the reference treatment exactly", () => {
  /*
   * The uniformity Sean actually asked for. These are non-tappable LABELS, and
   * `.vote-pill` is the one he named as the reference (BAL-22) — so they take
   * its inset and its type, and any of them drifting is a defect rather than a
   * decision.
   */
  const census = pillCensus(css());
  const ref = census.reference!;
  for (const selector of [
    ".could-govern-pill",
    ".meeting-status-pill",
    ".stat-pill",
    ".could-govern-notice-pill",
  ]) {
    const rule = census.measured.find((r) => r.selector === selector);
    assert.ok(rule, `${selector} is gone from the stylesheet`);
    assert.equal(rule.sizing.padding, ref.sizing.padding, `${selector} inset drifted from the reference`);
    if (rule.sizing["font-size"]) {
      assert.equal(
        rule.sizing["font-size"],
        ref.sizing["font-size"],
        `${selector} type size drifted from the reference`,
      );
    }
  }
});

test("BAL-12: the ACTION pills share one inset and one tap target", () => {
  // Font size is deliberately NOT flattened across these — the reasons file
  // says why, per pill. What is uniform is the thing Sean photographed: the
  // height and the inset.
  const census = pillCensus(css());
  for (const selector of [".ask-pill", ".speak-pill", ".contact-pill"]) {
    const rule = census.measured.find((r) => r.selector === selector);
    assert.ok(rule, `${selector} is gone`);
    assert.equal(rule.sizing.padding, "0 14px", `${selector} inset is not the action-pill inset`);
    assert.equal(rule.sizing["min-height"], "44px", `${selector} lost its 44px tap target`);
  }
});
