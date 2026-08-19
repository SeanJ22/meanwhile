import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WALK = join(ROOT, "scripts", "walk-all.mts");

/**
 * R49: NO BLIND WAIT SURVIVES UNJUSTIFIED (2026-08-18, g16).
 *
 * A fixed wait followed by a single read cannot tell GONE from NOT YET, and it
 * reports the first when it means the second. It produced FOUR FALSE
 * REGRESSION REPORTS in one session — the pin floor (R47), the ask refusal
 * (A07), the A02 digest, and the classifier route — every one of them against a
 * build with nothing wrong with it. A suite that cries wolf gets muted, and a
 * muted regression net is worse than none.
 *
 * The rule this pins: every `waitForTimeout` left in `walk-all.mts` carries a
 * comment saying WHY a duration is the right instrument there, in the two lines
 * above it. Three reasons are legitimate and each has its own marker:
 *
 *   R49 POLL INTERVAL      — how often a poll asks; the loop exits on an outcome.
 *   R49 SAMPLING INTERVAL  — a continuous sample, which is the R47 fix itself.
 *   R49 DURATION, DELIBERATE — the wait IS the assertion: outlasting a timer
 *                              that must not fire, letting a compositor paint,
 *                              or holding still for a geometry read that would
 *                              be wrong mid-flight.
 *
 * THE COUNT IS ASSERTED, not just the markers. A count that may only fall is
 * what stops the class regrowing one convenient sleep at a time; raising it is
 * a deliberate act with a number attached, exactly like the bundle budget.
 */

const source = readFileSync(WALK, "utf8");
const lines = source.split(/\r?\n/);

const MARKERS = ["R49 POLL INTERVAL", "R49 SAMPLING INTERVAL", "R49 DURATION, DELIBERATE"];

/** Every line index that calls waitForTimeout. */
const callSites = lines
  .map((line, i) => ({ line, i }))
  .filter(({ line }) => /await page\.waitForTimeout\(/.test(line));

test("every fixed wait left in walk:all says why it is a duration", () => {
  /* The denominator, stated: a guard that finds no unjustified waits while
   * inspecting no waits is the empty success this repo has a rule about. */
  assert.ok(
    callSites.length > 0,
    "no waitForTimeout call was found at all — this test is inspecting the wrong file",
  );

  const unjustified: string[] = [];
  for (const { i } of callSites) {
    // The justification sits directly above, within the comment block that
    // introduces it. Six lines is the longest of the current reasons.
    const above = lines.slice(Math.max(0, i - 6), i).join("\n");
    if (!MARKERS.some((m) => above.includes(m))) {
      unjustified.push(`walk-all.mts:${i + 1} — ${lines[i].trim()}`);
    }
  }

  assert.deepEqual(
    unjustified,
    [],
    "these fixed waits carry no R49 justification. A wait that cannot be made " +
      "event-driven must say why, in one of the three marked forms; anything else " +
      "is the class that filed four false regressions in a single session:\n  " +
      unjustified.join("\n  "),
  );
});

test("the count of fixed waits may fall, never rise", () => {
  /*
   * MEASURED 2026-08-18 (g16), after converting the class: 36 fixed waits at
   * the start of the session (R49's own audit counted 36 with 3 converted), 12
   * remain, and every one of the 12 is justified above. The two biggest wins
   * are not in this number: `openAt` and `openWideAt` each slept NINE SECONDS
   * after every page load, roughly sixty times a run.
   *
   * Lowering this number is ordinary work. Raising it needs a reason written
   * beside the new wait AND this number moved on purpose.
   */
  /*
   * F01 (2026-08-19): 12 → 14, moved deliberately, both with reasons beside
   * the waits. Both belong to the 9.6 preservation check:
   *
   *   1. The district LAYER load. Boundaries are WebGL, not DOM, so there is
   *      no element to poll for at all.
   *   2. The settle after the map click. That click can open a picker, a card,
   *      or nothing, and “nothing” is a legitimate COULD NOT RUN — polling for
   *      “either of two things or neither” is a fixed wait wearing a loop.
   */
  assert.ok(
    callSites.length <= 14,
    `walk-all.mts now has ${callSites.length} fixed waits, up from the committed 14. ` +
      "A new blind wait is the defect R49 exists to stop — convert it to an outcome " +
      "wait, or move this number deliberately with the reason beside the wait.",
  );
});
