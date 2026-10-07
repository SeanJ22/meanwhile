import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  offScaleSpacing,
  offFamilyRadius,
  rawFontSize,
  rawElevation,
  rhythmScalesDeclared,
  componentRhythm,
} from "../lib/design/rhythm.ts";

const ROOT = join(import.meta.dirname, "..");
const GLOBALS = join(ROOT, "app", "globals.css");

// The reader design rules live in app/reader.css (globals.css mirror cap); the scale applies to both.
const css = readFileSync(GLOBALS, "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");

test("the rhythm sweep catches an off-scale value — the instrument works (RULING 110)", () => {
  assert.equal(offScaleSpacing(".x{padding:13px}").length, 1, "13px is off the spacing scale");
  assert.equal(offScaleSpacing(".x{padding:var(--space-3)}").length, 0, "a token is on-scale");
  assert.equal(offScaleSpacing(".x{padding:16px 24px}").length, 0, "16/24 are on-scale");
  assert.equal(offFamilyRadius(".x{border-radius:5px}").length, 1, "a raw radius is off-family");
  assert.equal(offFamilyRadius(".x{border-radius:var(--radius-pill)}").length, 0, "a token is on-family");
  assert.equal(rawFontSize(".x{font-size:11px}").length, 1, "a raw font-size is off-scale");
  assert.equal(rawFontSize(".x{font-size:var(--text-caption)}").length, 0, "a token is on-scale");
  assert.equal(rawElevation(".x{box-shadow:0 6px 20px rgba(0,0,0,.2)}").length, 1, "a raw drop shadow is off-family");
  assert.equal(rawElevation(".x{box-shadow:var(--shadow-card)}").length, 0, "a token is on-family");
  assert.equal(rawElevation(".x{box-shadow:0 0 0 3px color-mix(in srgb,var(--bg) 85%,transparent)}").length, 0, "a focus ring is not elevation");
});

test("the rhythm token scales are declared in app/globals.css", () => {
  assert.ok(rhythmScalesDeclared(css), "expected --space-1, --radius-pill and --text-body to be declared");
});

test("component sweep catches new tiny type, off-scale spacing and literal colours", () => {
  assert.equal(componentRhythm('<p className="text-[9px] px-[13px] gap-[0.3rem] text-[#ff0000]" />').length, 4);
  assert.equal(componentRhythm('<p className="t-body p-[var(--space-3)] gap-[16px] text-paper" />').length, 0);
  assert.equal(componentRhythm('{/* text-[9px] #fff */}').length, 0);
});
