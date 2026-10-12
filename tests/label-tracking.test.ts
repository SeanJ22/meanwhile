import assert from "node:assert/strict";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * A letter-spaced uppercase run may not lose its last letter: `letter-spacing` adds its space after the final
 * glyph, so against a clipping right edge the clip bites into the last letter.
 */

const ROOT = process.cwd();
/** Any `tracking-[0.Nem]` value, not only those starting at 0.1. */
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

/** Every letter-spaced run carries a matching trim, whether or not anything clips it today. */
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
    stillPinned.length > 0,
    "no shrink-0 letter-spaced run remains — the predicate matches nothing",
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
  /* The floor proves only that the predicate matches something; the population may legitimately shrink. */
  assert.ok(
    tracked.length > 0,
    "no component carries a letter-spaced run at all — the predicate matches nothing and every OFF-2 guard above is vacuous",
  );
});

/**
 * The stylesheet is swept too. Compensation and `letter-spacing` live in different rules, so this resolves per
 * selector across the whole file. Below 0.05em the declaration is micro-tracking on prose, where the text wraps
 * rather than clipping.
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

/** The two selectors that are letter-spaced and correctly carry no trim, each with its reason. */
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
  /* The instrument is shown catching the thing it was written for: a compensated selector stripped of its trim. */
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
