/**
 * ALIGN-1 — EVERYTHING READS LEFT TO RIGHT. NOTHING INDENTS RIGHT.
 * (2026-08-25, the author's spec captures `17-18-44`, `17-30-58`, `17-53-26`.)
 *
 * The single most repeated complaint of the 8/25 evening walkthrough, and one
 * declaration behind all of it: `.person-row` was `justify-content: flex-end`,
 * so every name in the product sat pushed to the right of the district or body
 * it serves while the district's own label sat at the left margin.
 *
 * **`.person-row` is the SHARED row**, which is why the four surfaces he named
 * are four renderings of one line of CSS:
 *
 * | Surface | Component | Block |
 * |---|---|---|
 * | Who Governs Here | `components/map/coverage-notice.tsx` | representation |
 * | Small battlecard | `components/map/popup/district-popup.tsx` | who runs it |
 * | Small battlecard | `components/map/popup/district-popup.tsx` | representation |
 *
 * His instruction with the captures: *assume this is how all of them look, not
 * just the ones photographed.* They do, and this is why.
 *
 * **What is NOT in this class, checked rather than assumed.** A row that puts
 * the NAME first and a label after it — `justify-between` on the ballot
 * candidate card, on the door overlay's seat list, and the `.pk`/`.pv` fact
 * table on the popups — already reads left to right. Those were swept and left
 * alone; right-aligning a trailing LABEL is not indenting a NAME.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const css = () => readFileSync("app/globals.css", "utf8");

/** The `.person-row` rule body, read out of the stylesheet rather than matched loosely. */
function personRowBlock(): string {
  const m = /\n\.person-row\s*\{([^}]*)\}/.exec(css());
  assert.ok(m, ".person-row is no longer declared in globals.css");
  return m[1];
}

test("ALIGN-1: the shared person row flows from the left", () => {
  const block = personRowBlock();
  assert.match(
    block,
    /justify-content:\s*flex-start/,
    "`.person-row` must state `justify-content: flex-start`. It was `flex-end`, which " +
      "is what put every representative's name to the right of the district they serve " +
      "on Who Governs Here and on both blocks of every small battlecard. The property " +
      "is STATED rather than deleted so the next edit cannot reintroduce this by " +
      "leaving it out and inheriting a default.",
  );
  assert.doesNotMatch(
    block,
    /justify-content:\s*(?:flex-)?end|justify-content:\s*right/,
    "`.person-row` is right-justified again — ALIGN-1 has regressed",
  );
});

test("ALIGN-1: the row is still a wrapping baseline row (NH-1 is not undone)", () => {
  /*
   * NH-1 turned this from a column into a wrapping row so a person took one
   * line instead of two, and a long name still wraps rather than truncating —
   * a truncated name is a different person's name. Changing the justification
   * must not have cost any of that.
   */
  const block = personRowBlock();
  assert.match(block, /display:\s*flex/);
  assert.match(block, /flex-direction:\s*row/);
  assert.match(block, /flex-wrap:\s*wrap/);
  assert.match(block, /align-items:\s*baseline/);
});

test("ALIGN-1: both consumers of the shared row still use it", () => {
  /*
   * The fix is only class-wide while the class is shared. If a surface stops
   * using `.person-row` and hand-rolls its own layout, this guard would keep
   * passing about a rule nobody reads — so the consumers are asserted by name.
   */
  const consumers = [
    "components/map/coverage-notice.tsx",
    "components/map/popup/district-popup.tsx",
  ];
  for (const file of consumers) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /className="person-row"/,
      `${file} no longer renders \`.person-row\`. ALIGN-1's fix is one declaration ` +
        `on a SHARED row; a surface that leaves the class takes its own alignment ` +
        `with it and this guard stops covering it.`,
    );
  }

  /* And the district popup uses it for BOTH blocks — who-runs-it and the full
     roster — which is two of the four surfaces the author named. */
  const popup = readFileSync("components/map/popup/district-popup.tsx", "utf8");
  const uses = popup.match(/className="person-row"/g) ?? [];
  assert.ok(
    uses.length >= 2,
    `the small battlecard renders \`.person-row\` ${uses.length} time(s); the ` +
      `who-runs-it block and the representation list are both in ALIGN-1's scope`,
  );
});

test("ALIGN-1: no OTHER rule right-justifies a person row", () => {
  /*
   * The class sweep, held open. A later `.person-row-name { margin-left: auto }`
   * or a `justify-end` on the element would re-create the defect without
   * touching the rule above, and this guard would have passed.
   */
  const offenders: string[] = [];
  const stylesheet = css();
  for (const m of stylesheet.matchAll(/\n(\.person-row[a-z-]*)\s*\{([^}]*)\}/g)) {
    if (/margin-left:\s*auto|margin-inline-start:\s*auto|text-align:\s*right/.test(m[2])) {
      offenders.push(`${m[1]} pushes itself right`);
    }
  }

  const files = execSync("git ls-files -z", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => /^(?:app|components)\/.*\.tsx$/.test(f));
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!/className="person-row"/.test(line)) continue;
      if (/justify-end|ml-auto|text-right/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], "a person row is being pushed right by something other than the shared rule");
});

/* ========================================================================== */
/* WGH-11 — an annotation sits against the word it annotates                  */
/* ========================================================================== */

/**
 * **The mark was a flex ITEM in a `justify-between` row**, so it was
 * distributed into the dead space between the body name and the right-aligned
 * type label. The author's `17-30-58` shows three of them floating a third of
 * the way across the panel.
 *
 * `.could-govern-mark` already declared `display: inline; margin-left: 3px` and
 * both were inert: flex overrides `display: inline` on its children, and a 3px
 * margin is invisible next to a `justify-between` gap. **The CSS was right and
 * the markup was wrong**, which is why a stylesheet-only reading of this would
 * have found nothing — the same instrument failure LBL-2 was reopened over.
 *
 * He is fine with the asterisk EXISTING; the objection is placement. So this
 * asserts the mark is a sibling of the name rather than asserting it is gone.
 */
test("WGH-11: the could-govern mark is inside the name's own flex item", () => {
  const src = readFileSync("components/map/coverage-notice.tsx", "utf8");
  /*
   * The row is located by its own data attribute and every assertion below is
   * on the ORDER of its parts. Nothing here reads indentation — see the note
   * on the wrapper assertion for why that matters.
   */
  const rowIdx = src.indexOf(`data-governing-row=""`);
  assert.ok(rowIdx >= 0, "the governing row is no longer recognisable in coverage-notice.tsx");
  const row = [src.slice(rowIdx)];

  const nameIdx = row[0].indexOf("body.name ?? body.divisionLabel");
  const markIdx = row[0].indexOf("<CouldGovernMark");
  const labelIdx = row[0].indexOf("TYPE_LABEL_CLASS");
  assert.ok(nameIdx >= 0 && markIdx >= 0 && labelIdx >= 0, "the row lost one of its three parts");
  assert.ok(
    markIdx < labelIdx,
    "the mark must precede the type label — it annotates the NAME, not the label",
  );

  /*
   * The load-bearing assertion: the name and the mark share a wrapper, so the
   * row's `justify-between` sees TWO items and not three.
   *
   * Structural rather than indentation-coupled. The first version of this
   * matched exact leading whitespace between the closing tag and the next
   * element, and failed on markup that was correct — a guard pinned to
   * formatting fails on a reformat and teaches nobody anything.
   */
  const wrapIdx = row[0].indexOf('<span className="inline-flex items-baseline">');
  assert.ok(
    wrapIdx >= 0,
    "the body name and its could-govern mark are no longer wrapped together. As separate " +
      "children of a `justify-between` row, the asterisk is distributed into the gap and " +
      "lands nowhere near the word it annotates — that is WGH-11.",
  );
  assert.ok(wrapIdx < nameIdx, "the wrapper must open before the name");
  assert.ok(nameIdx < markIdx, "the mark must follow the name it annotates");
});

test("WGH-11: the mark keeps the styling that only works once it is inline", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = /\.could-govern-mark\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, ".could-govern-mark is gone from globals.css");
  assert.match(rule[1], /display:\s*inline/);
  assert.match(rule[1], /margin-left:\s*3px/);
});
