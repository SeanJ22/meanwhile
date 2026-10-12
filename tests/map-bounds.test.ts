import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
  assert.match(
    CSS,
    /\.map-bottom-stack\s*\{[^}]*top:\s*var\(--map-control-band\)/,
    "the bottom stack has no upper bound at all",
  );

  // A bound inside a width query holds at one viewport and not at another.
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

  // The phone override moves the variable, not `.legend` itself, so the stack's gutter moves with it.
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
