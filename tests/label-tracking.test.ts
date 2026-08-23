import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/* ========================================================================== */
/* LBL-2 — a letter-spaced uppercase run may not lose its last letter         */
/* ========================================================================== */

/**
 * `VF03` was closed as "0 found, could not reproduce, did not guess". RULING 97
 * reopens it: when the author finds something the sessions did not, the defect
 * is in the DISCOVERY PROCEDURE, and absorbing the find is not an adequate
 * response.
 *
 * **What procedure would have found this without him?** Measuring a rendered
 * role string against its own box, on the card he was looking at, at the width
 * he was looking at it.
 *
 * **Why did that procedure not run?** The previous session read the
 * STYLESHEET, found no `nowrap` and no ellipsis on either role selector, and
 * stopped — an instrument that answers *is there a rule to clip this* when the
 * question is *is this clipped*. Refusing to guess at a fix was right. Stopping
 * without measuring was not.
 *
 * **What changed so it runs next time?** `pnpm shoot:visual` opens the card and
 * prints `scrollWidth` against `getBoundingClientRect().width` for every role
 * string on it, at both widths, and this guard holds the class-wide half.
 *
 * ## The cause is a property of `letter-spacing`, not of one card
 *
 * `letter-spacing` adds its space AFTER the final glyph. A run set at `0.15em`
 * is about a seventh of a character wider than the characters in it, and all
 * of that width sits past the last letter. Against any clipping right edge the
 * clip takes the trailing space first and then bites into the glyph — which is
 * exactly the symptom reported: the role loses its final letter.
 */

const ROOT = process.cwd();
const TRACKING = /tracking-\[0\.1[0-9]*em\]/;

function sourceFiles(): string[] {
  return execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => /^(?:app|components)\/.*\.tsx$/.test(f));
}

test("LBL-2: the shared letter-spaced label classes trim their trailing space", () => {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  assert.match(
    css,
    /\.trailing-space-trimmed\s*\{[^}]*margin-inline-end:\s*-0\.15em/,
    "the utility that removes the trailing letter-space is missing",
  );
  /*
   * The compensated SET is read out of the rule itself rather than by matching
   * each name loosely against the whole stylesheet. A loose match would pass
   * on a class that merely exists somewhere else in the file, which is a guard
   * agreeing with a file it never really read.
   */
  const block = /((?:\.[a-z-]+,\s*)+\.[a-z-]+)\s*\{\s*margin-inline-end:\s*-0\.15em/.exec(css);
  assert.ok(block, "the compensated selector list is missing from globals.css");
  for (const cls of [".t-eyebrow", ".text-label", ".notice-eyebrow", ".jurisdiction-badge"]) {
    assert.ok(block[1].includes(cls), `${cls} is no longer in the compensated set`);
  }
});

test("LBL-2: a letter-spaced run pinned with shrink-0 trims its trailing space", () => {
  /*
   * `shrink-0` is the shape that turns the trailing space into a clipped
   * letter: the element refuses to give width back, so it sits hard against
   * its row's right edge and anything clipping there takes the space and then
   * the glyph. A tracked run that can shrink is not in this class.
   */
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const line of src.split("\n")) {
      if (!TRACKING.test(line)) continue;
      if (!/\bshrink-0\b/.test(line)) continue;
      if (/trailing-space-trimmed/.test(line)) continue;
      offenders.push(`${file}: ${line.trim().slice(0, 110)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these letter-spaced uppercase runs are pinned at a container edge with no " +
      "trailing-space compensation. letter-spacing adds its space AFTER the last " +
      "glyph, so a right-edge clip takes the space and then the letter — which is " +
      "what LBL-2 reported. Add `trailing-space-trimmed`.",
  );
});

test("LBL-2: the sweep reaches the tree it claims to", () => {
  // A sweep that scanned nothing would pass loudest exactly when it stopped
  // working — the same discipline every other census in this repo carries.
  const files = sourceFiles();
  assert.ok(files.length > 40, `only ${files.length} component file(s) scanned`);
  const tracked = files.filter((f) => TRACKING.test(readFileSync(join(ROOT, f), "utf8")));
  assert.ok(
    tracked.length > 10,
    `only ${tracked.length} file(s) carry a letter-spaced run — the population collapsed`,
  );
});
