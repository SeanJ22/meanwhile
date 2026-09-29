import assert from "node:assert/strict";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
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
/**
 * **LBL-2, THIRD PASS (2026-08-25) — THE VALUE ANCHOR WAS THE HOLE.**
 *
 * This read `tracking-\[0\.1[0-9]*em\]` — anchored on the digit `1`. It matched
 * 0.1, 0.14, 0.15, 0.16 and 0.18 and was BLIND to `0.2em`, the most-used
 * tracking in the product. Measured on the day it was widened: **41 inline runs
 * in `app/` and `components/`, 20 inside the old predicate and 21 outside it
 * and uncompensated** — 19 at 0.2em, one at 0.08em, one at 0.06em.
 *
 * OFF-2 retired the `shrink-0` predicate for exactly the right reason and left
 * this one in place, so the guard went on reporting green about half a
 * population. `[0-9]+` has no value it cannot see.
 */
const TRACKING = /tracking-\[0\.[0-9]+em\]/;

function sourceFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT })
    .filter((f) => /^(?:app|components)\/.*\.tsx$/.test(f));
}

test("LBL-2: the shared letter-spaced label classes trim their trailing space", () => {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
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

/**
 * **OFF-2 (2026-08-24) — THE `shrink-0` PREDICATE IS RETIRED, AND THIS IS THE
 * RECONCILIATION THE BRIEF ASKED FOR.**
 *
 * `LBL-2` closed at "6 found, 6 fixed" on 2026-08-23. **It did not regress** —
 * all six still carry their compensation, asserted below. The author then found
 * the same defect on the Tucson Unified small card (`12-06-33`), so the
 * question is why the sweep missed a seventh.
 *
 * **Which selector this instance uses.** `.source-tag` inside
 * `.person-row-office`, in `components/map/popup/district-popup.tsx`. The run
 * carries `tracking-[0.1em]` and NO `shrink-0`.
 *
 * **Why the sweep missed it.** The predicate tested for `shrink-0` on the
 * ELEMENT — one way of pinning a run against a container's right edge. This
 * run is pinned by its PARENT: `.person-row` is `justify-content: flex-end`,
 * declared in `globals.css`, which a line-based grep over `.tsx` files cannot
 * see. Measured at the time of the fix: 23 letter-spaced runs, 6 inside the old
 * predicate, **17 outside it and uncompensated**, including all four
 * `.source-tag` sites.
 *
 * **What changed so it runs next time.** The predicate is not widened — every
 * way of pinning an element at an edge would have to be enumerated, and the
 * next one nobody thought of would be the next OFF-2. It is REPLACED by the
 * physics: `letter-spacing` adds its space after the final glyph on every run,
 * always, so the space is spurious whether or not anything clips it today.
 * **Every letter-spaced run carries a matching trim, with no exceptions to get
 * wrong.**
 */
test("OFF-2: EVERY letter-spaced run trims its trailing space, not only the pinned ones", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    src.split("\n").forEach((line, i) => {
      if (!TRACKING.test(line)) return;
      if (/trailing-space-trimmed/.test(line)) return;
      offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "these letter-spaced uppercase runs carry no trailing-space compensation. " +
      "letter-spacing adds its space AFTER the last glyph, so any right edge — " +
      "an element's own `shrink-0`, or a parent's `justify-content: flex-end`, " +
      "which is what OFF-2 turned out to be — takes the space and then the " +
      "letter. Add the `trailing-space-trimmed-NN` matching this run's tracking.",
  );
});

test("OFF-2: the trim MATCHES its run's tracking, never a near-enough value", () => {
  // A -0.15em compensation on a 0.1em run pulls the label 0.05em into whatever
  // precedes it. Smaller than the defect it fixes, and the same carelessness.
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  const mismatched: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    src.split("\n").forEach((line, i) => {
      const tracking = /tracking-\[0\.([0-9]+)em\]/.exec(line);
      if (!tracking) return;
      const digits = tracking[1];
      const want =
        digits.length === 1 ? Number(digits) * 10 : Number(digits);
      // The legacy alias is the 0.15em trim under its original name.
      const ok =
        line.includes(`trailing-space-trimmed-${want}`) ||
        (want === 15 && /trailing-space-trimmed(?!-)/.test(line));
      if (!ok) {
        mismatched.push(
          `${file}:${i + 1}: tracking 0.${digits}em wants trailing-space-trimmed-${want}`,
        );
      }
    });
  }
  assert.deepEqual(mismatched, [], "a trim does not match the run it compensates");

  // And every utility the components ask for actually exists in the stylesheet,
  // carrying the em value its NAME promises — a utility named for 0.14em and
  // declaring 0.15em would satisfy the per-site check above while trimming the
  // wrong amount everywhere it is used.
  for (const value of [6, 8, 10, 14, 15, 16, 18, 20]) {
    const em = String(value / 100); // 10 -> "0.1", 14 -> "0.14"
    assert.match(
      css,
      new RegExp(
        `\\.trailing-space-trimmed-${value}\\s*\\{[^}]*margin-inline-end:\\s*-${em.replace(".", "\\.")}em`,
      ),
      `the trailing-space-trimmed-${value} utility is missing or declares the wrong em value`,
    );
  }
});

test("OFF-2: the six LBL-2 sites fixed on 2026-08-23 have NOT regressed", () => {
  // The reconciliation's other half. A seventh instance appearing is one
  // finding; the original six quietly coming undone would be a different one,
  // and a report that could not tell them apart would be guessing.
  const stillPinned: string[] = [];
  for (const file of sourceFiles()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const line of src.split("\n")) {
      if (!TRACKING.test(line)) continue;
      if (!/\bshrink-0\b/.test(line)) continue;
      stillPinned.push(line);
    }
  }
  assert.ok(
    stillPinned.length >= 6,
    `only ${stillPinned.length} shrink-0 letter-spaced runs remain — the LBL-2 population collapsed`,
  );
  for (const line of stillPinned) {
    assert.match(
      line,
      /trailing-space-trimmed/,
      `an LBL-2 site lost its compensation: ${line.trim().slice(0, 110)}`,
    );
  }
});

test("LBL-2: the sweep reaches the tree it claims to", () => {
  // A sweep that scanned nothing would pass loudest exactly when it stopped
  // working — the same discipline every other census in this repo carries.
  const files = sourceFiles();
  assert.ok(files.length > 40, `only ${files.length} component file(s) scanned`);
  const tracked = files.filter((f) => TRACKING.test(readFileSync(join(ROOT, f), "utf8")));
  /*
   * **THE FLOOR WAS `> 10` AND IT WENT RED ON THE DAY THE WORK WAS DONE.**
   * (2026-08-25, BC-14.)
   *
   * Removing three `.source-tag` render sites took the population from 11 to
   * 10, and this failed — reporting "the population collapsed" about a
   * deliberate simplification. That is RULING 116 precisely: a guard may pin
   * an INVARIANT or a DIRECTION, never the size of a set that legitimately
   * moves, because it fails on the day somebody makes progress and the
   * cheapest way to green is to edit the constant.
   *
   * The anti-vacuity claim this test is FOR is the corpus assertion above —
   * that the sweep read the tree rather than an empty list. The population
   * floor drops to the smallest number that still proves the predicate
   * MATCHES SOMETHING; if letter-spaced runs ever genuinely reach zero, the
   * four guards above have nothing to check and this says so.
   *
   * What holds the real line is `OFF-2` above: EVERY run that exists is
   * compensated, whatever the count. That assertion gets stronger as this one
   * gets smaller, which is the right direction for both.
   */
  assert.ok(
    tracked.length > 0,
    "no component carries a letter-spaced run at all — the predicate matches nothing and every OFF-2 guard above is vacuous",
  );
});

/* ========================================================================== */
/* LBL-2, THIRD PASS — THE STYLESHEET IS SWEPT TOO                            */
/* ========================================================================== */

/**
 * **The other half of the hole, and OFF-2 named it without closing it.**
 *
 * OFF-2's own note says the pin its predicate missed lived in `globals.css`
 * "where a line-based grep over `.tsx` cannot see" it — and the sweep it then
 * wrote still reads only `.tsx`. Every letter-spaced run declared in the
 * stylesheet has been outside every LBL-2 guard since the first one.
 *
 * Measured on adoption: **38 selectors here declare a positive
 * `letter-spacing`. Four were compensated. Fourteen sat at 0.05em or more with
 * none** — including `.popup-section-label` (`WHO RUNS IT`), `.popup-type`
 * (`SCHOOL (SECONDARY)`) and `.filter-label`, all of which render pinned
 * against a card edge.
 *
 * **Compensation and `letter-spacing` live in DIFFERENT RULES**, which is why
 * this resolves per SELECTOR across the whole file rather than looking inside
 * one block: `.t-eyebrow` declares its tracking in one place and takes its trim
 * from a five-selector rule elsewhere, and a same-block check would have called
 * it an offender.
 *
 * **The 0.05em floor is stated rather than hidden.** Below it the declaration
 * is micro-tracking on prose — `.pill` at 0.01em, `.person-row-party` at
 * 0.01em — where the space is a fraction of a pixel and the text wraps rather
 * than clipping. The floor is where a letter-spaced LABEL RUN begins.
 */
const CSS_TRIM_FLOOR_EM = 0.05;

/** Roughly the size these letter-spaced labels are set at, for px → em. */
const LABEL_PX = 11;

type SpacedRule = { selector: string; value: string; em: number };

function stylesheetRules(): { spaced: SpacedRule[]; compensated: Set<string> } {
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  const spaced = new Map<string, SpacedRule>();
  const compensated = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim().split("\n").pop()!.trim())
      .filter((s) => s.startsWith("."));
    const body = m[2];
    const ls = /letter-spacing:\s*([^;]+)/.exec(body);
    if (ls) {
      const value = ls[1].trim();
      const em = /em$/.test(value)
        ? Number.parseFloat(value)
        : /px$/.test(value)
          ? Number.parseFloat(value) / LABEL_PX
          : Number.NaN;
      if (Number.isFinite(em) && em > 0) {
        for (const s of selectors) spaced.set(s, { selector: s, value, em });
      }
    }
    if (/margin-inline-end:\s*-/.test(body)) for (const s of selectors) compensated.add(s);
  }
  return { spaced: [...spaced.values()], compensated };
}

/**
 * The two selectors that are letter-spaced and correctly carry no trim.
 *
 * **Each is exempt for a stated reason, and stating it is the mechanism** —
 * the same one `tests/guard-census.json` uses to let a guard leave. A
 * carve-out nobody has to write down is a carve-out that grows (RULING 107).
 */
const CSS_TRIM_EXEMPT: Record<string, string> = {
  ".t-structure":
    "a flex container whose text is followed by an ::after rule taking the remaining " +
    "width. The trailing space falls in the gap before the shelf, never against a " +
    "clipping edge, and trimming it would pull the shelf into the final letter.",
  ".zip-switcher-entry input":
    "a form field. Its trailing space sits inside its own padding, so a negative " +
    "inline-end margin would shrink the field rather than free a glyph.",
};

test("LBL-2: the stylesheet sweep reaches the stylesheet", () => {
  const { spaced } = stylesheetRules();
  assert.ok(
    spaced.length > 20,
    `only ${spaced.length} letter-spaced selector(s) found — the stylesheet sweep read almost nothing`,
  );
  assert.ok(
    spaced.some((r) => r.em >= CSS_TRIM_FLOOR_EM),
    "no selector reaches the label-run floor — every assertion below is vacuous",
  );
  assert.ok(
    spaced.some((r) => /px$/.test(r.value)),
    "no px-declared tracking found — the px branch of the reader is unexercised, " +
      "and eight of the fourteen originally-uncompensated label runs declared theirs in px",
  );
});

test("LBL-2: every letter-spaced LABEL RUN in globals.css trims its trailing space", () => {
  const { spaced, compensated } = stylesheetRules();
  const offenders: string[] = [];
  for (const rule of spaced) {
    if (rule.em < CSS_TRIM_FLOOR_EM) continue;
    if (compensated.has(rule.selector)) continue;
    if (rule.selector in CSS_TRIM_EXEMPT) continue;
    offenders.push(`${rule.selector} (letter-spacing: ${rule.value})`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these stylesheet selectors set a label-sized letter-spacing and never take it " +
      "back. letter-spacing puts its space AFTER the last glyph, so against any " +
      "clipping right edge the clip takes the space and then the letter — which is " +
      "LBL-2, on its third sighting. Add `margin-inline-end: -<the same value>` to " +
      "the rule, or add the selector to CSS_TRIM_EXEMPT with the reason it does not " +
      "need one.",
  );
});

test("LBL-2: an exemption names a selector that actually exists and is spaced", () => {
  // An exemption list that outlives its selectors is a list nobody has read,
  // and the next real offender could be added to it by a name collision.
  const { spaced } = stylesheetRules();
  const spacedNames = new Set(spaced.map((r) => r.selector));
  for (const [selector, reason] of Object.entries(CSS_TRIM_EXEMPT)) {
    assert.ok(
      spacedNames.has(selector),
      `${selector} is exempt from the trim and is no longer a letter-spaced rule — remove the exemption`,
    );
    assert.ok(reason.length > 40, `${selector}'s exemption does not state a reason`);
  }
});

test("LBL-2: the stylesheet sweep catches a real offender", () => {
  /*
   * RULING 110 — the instrument is shown catching the thing it was written
   * for. `.popup-section-label` is one of the fourteen this pass compensated;
   * it renders `WHO RUNS IT` pinned inside a card. Stripping its trim must be
   * visible to the sweep.
   */
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  const rule = /\n\.popup-section-label\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, ".popup-section-label is gone — the plant cannot be made");
  assert.match(
    rule[1],
    /letter-spacing:\s*1\.4px/,
    ".popup-section-label no longer carries the tracking this plant depends on",
  );
  assert.match(
    rule[1],
    /margin-inline-end:\s*-1\.4px/,
    ".popup-section-label lost its LBL-2 compensation — the label that reads WHO RUNS IT " +
      "on every small battlecard is clipping its last letter again",
  );
});
