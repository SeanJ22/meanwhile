import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * 4c (2026-08-15) — the map's overlay bounds, held as text.
 *
 * Two of the author's three production defects were the same shape twice
 * over: a rule that bounds an overlay, scoped to one viewport width, quietly
 * doing nothing at another. The who-governs card's upper bound lived inside a
 * `max-width: 639px` query because the bug that produced it was found on a
 * phone; at 1280×800 the New Hampshire card measured 1072px tall with its top
 * at y = −272, and the reader lost the top of the card exactly as the phone
 * reader had.
 *
 * A layout regression is not something a unit test can see. What it CAN see
 * is the specific structural mistake that caused both: the bound sitting
 * inside a width query, or the numbers that two rules must agree on being
 * written twice. That is what these guards read for. The live measurements
 * live in the walk, which is where pixels belong.
 */

const CSS = readFileSync(
  join(import.meta.dirname, "..", "app", "globals.css"),
  "utf8",
);

/** The body of every `@media` block, so a rule can be tested for being inside one. */
function mediaBlocks(css: string): string[] {
  const blocks: string[] = [];
  const re = /@media[^{]*\{/g;
  while (re.exec(css) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    blocks.push(css.slice(re.lastIndex, i - 1));
  }
  return blocks;
}

const MEDIA = mediaBlocks(CSS);

test("4c: the bottom stack's upper bound is not scoped to one viewport width", () => {
  // The rule exists at all.
  assert.match(
    CSS,
    /\.map-bottom-stack\s*\{[^}]*top:\s*var\(--map-control-band\)/,
    "the bottom stack has no upper bound at all",
  );

  // And it is NOT inside a width query. This is the whole defect: a bound
  // that holds on a phone and not on a laptop is not a bound, it is a
  // coincidence that was true on the machine somebody tested on.
  const scoped = MEDIA.filter((block) =>
    /\.map-bottom-stack\s*\{[^}]*top:\s*var\(--map-control-band\)/.test(block),
  );
  assert.deepEqual(
    scoped.map(() => "scoped"),
    [],
    "the bottom stack's upper bound is inside a @media block again",
  );
});

test("4c: the legend's band is one named number, not two written twice", () => {
  // The collision the author reported: the "Last checked" footnote sat under
  // the legend at 390px, and the legend is ambient chrome at z-1100 so it
  // simply painted over the text. The fix has to survive somebody changing
  // the legend's size, which means both rules read the same variables.
  assert.match(CSS, /--map-legend-bottom:\s*\d+px/, "no legend band declared");
  assert.match(CSS, /--map-legend-height:\s*\d+px/, "no legend height declared");

  assert.match(
    CSS,
    /\.legend\s*\{[^}]*bottom:\s*var\(--map-legend-bottom\)/,
    "the legend does not read its own band variable",
  );
  assert.match(
    CSS,
    /\.map-bottom-stack\s*\{[^}]*padding-bottom:\s*calc\(\s*var\(--map-legend-bottom\)\s*\+\s*var\(--map-legend-height\)/,
    "the stack's gutter is not computed from the legend's own numbers",
  );

  // The phone override moves the VARIABLE, not the legend's own rule — if it
  // moved only `.legend`, the stack's gutter would stay behind and the two
  // would drift apart into exactly this collision again.
  const phoneOverrides = MEDIA.filter((b) => /--map-legend-bottom:\s*\d+px/.test(b));
  assert.equal(
    phoneOverrides.length,
    1,
    `${phoneOverrides.length} media blocks redefine the legend band; expected exactly 1`,
  );
  for (const block of MEDIA) {
    assert.ok(
      !/\.legend\s*\{[^}]*bottom:\s*\d+px/.test(block),
      "a media block sets the legend's bottom directly instead of the variable",
    );
  }
});
