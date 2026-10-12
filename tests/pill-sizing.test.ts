// Pill sizing: each pill is uniform, out of scope with a recorded reason, or a difference with no reason. Only the
// third is a defect.
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
const css = () => readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
const reasons = () =>
  JSON.parse(readFileSync(join(ROOT, "tests", "pill-sizing-reasons.json"), "utf8")) as PillReasons;

test("BAL-12: the census reaches the stylesheet at all", () => {
  // The floor: a parse that found nothing would report perfect uniformity.
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
  // A recorded reason for a difference that has since been normalised is stale.
  const split = splitCensus(pillCensus(css()), reasons());
  assert.deepEqual(split.stale, [], "these reasons describe differences that no longer exist");
});

test("BAL-12: the TAG pills carry the reference treatment exactly", () => {
  // Non-tappable labels take the `.vote-pill` reference's inset and type.
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
  // Font size is deliberately not flattened across these (the reasons file says why); height and inset are.
  const census = pillCensus(css());
  for (const selector of [".ask-pill", ".speak-pill", ".contact-pill"]) {
    const rule = census.measured.find((r) => r.selector === selector);
    assert.ok(rule, `${selector} is gone`);
    assert.equal(rule.sizing.padding, "0 14px", `${selector} inset is not the action-pill inset`);
    assert.equal(rule.sizing["min-height"], "44px", `${selector} lost its 44px tap target`);
  }
});
