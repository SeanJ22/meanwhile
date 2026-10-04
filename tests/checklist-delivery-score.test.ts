import assert from "node:assert/strict";
import test from "node:test";
import { checklistFraction } from "../lib/control-plane/readiness/checklist-score.ts";

test("zero denominator is unmeasured and display never rounds incomplete to 100", () => {
  assert.equal(checklistFraction(0, 0, 1).percent, null);
  assert.equal(checklistFraction(9999, 10000, 0).percent, 99.9);
});
