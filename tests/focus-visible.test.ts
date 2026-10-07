import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  globalFocusRingPresent,
  focusRingSuppressedWithoutAlternative,
} from "../lib/design/focus.ts";

const ROOT = join(import.meta.dirname, "..");
const GLOBALS = join(ROOT, "app", "globals.css");

test("the focus sweep catches a suppressed ring — the instrument works (RULING 110)", () => {
  assert.ok(globalFocusRingPresent(":focus-visible { outline: 2px solid var(--link); }"));
  assert.equal(globalFocusRingPresent(".x:focus { outline: none; }"), false, "plain :focus is not the global ring");

  // PLANT: a :focus-visible that removes the ring and offers nothing back.
  const bad = ".btn:focus-visible { outline: none; }";
  assert.equal(focusRingSuppressedWithoutAlternative(bad).length, 1);

  // KNOWN GOOD: a :focus-visible that swaps the outline for a box-shadow ring.
  const good = ".btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--link); }";
  assert.equal(focusRingSuppressedWithoutAlternative(good).length, 0);

  // A plain :focus dropping the outline for a lit border is the deliberate
  // mouse-vs-keyboard split, not an offender.
  const focusBorder = ".input:focus { outline: none; border-color: var(--link); }";
  assert.equal(focusRingSuppressedWithoutAlternative(focusBorder).length, 0);
});

test("app/globals.css keeps a global focus-visible ring and never suppresses it bare", () => {
  const css = readFileSync(GLOBALS, "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  assert.ok(globalFocusRingPresent(css), "expected a global :focus-visible outline ring");
  const offenders = focusRingSuppressedWithoutAlternative(css);
  assert.deepEqual(
    offenders,
    [],
    "controls that remove :focus-visible with no alternative:\n" +
      offenders.map((o) => `  L${o.line}: ${o.selector}`).join("\n"),
  );
});
