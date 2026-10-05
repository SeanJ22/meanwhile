import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  offScaleSpacing,
  offFamilyRadius,
  rawFontSize,
  rawElevation,
  rhythmScalesDeclared,
  componentRhythm,
  type RhythmOffender,
} from "../lib/design/rhythm.ts";

const ROOT = join(import.meta.dirname, "..");
const GLOBALS = join(ROOT, "app", "globals.css");
const BASELINE = join(ROOT, "tests", "rhythm-tokens.baseline.json");

/**
 * **WORK ITEM 2 — one spacing / radius / elevation / type scale, ratcheting.**
 * (The visual-polish session, 2026-09-03.)
 *
 * Every off-scale literal is frozen to a baseline that only SHRINKS: a new one
 * fails, and clearing an old one is a visible diff. Snapping the existing
 * off-scale values to the scale is the author's-eye consolidation (RULING 137)
 * and is tracked as carried work, not done blind here.
 */

interface Category {
  count: number;
  values: string[];
}
interface Baseline {
  spacing: Category;
  radius: Category;
  fontSize: Category;
  elevation: Category;
  components: Record<string, Record<string, number>>;
}

// The reader design rules live in app/reader.css (globals.css mirror cap); the scale applies to both.
const css = readFileSync(GLOBALS, "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;

const CATEGORIES: { name: Exclude<keyof Baseline, "components">; sweep: (c: string) => RhythmOffender[] }[] = [
  { name: "spacing", sweep: offScaleSpacing },
  { name: "radius", sweep: offFamilyRadius },
  { name: "fontSize", sweep: rawFontSize },
  { name: "elevation", sweep: rawElevation },
];

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

test("component exceptions only shrink, per file and value", () => {
  const visit = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? visit(path) : path.endsWith(".tsx") ? [path] : [];
  });
  const additions: string[] = [];
  for (const path of [...visit("app"), ...visit("components")]) {
    const counts: Record<string, number> = {};
    for (const offender of componentRhythm(readFileSync(join(ROOT, path), "utf8"))) {
      counts[offender.text] = (counts[offender.text] ?? 0) + 1;
    }
    for (const [value, count] of Object.entries(counts)) {
      if (count > (baseline.components[path]?.[value] ?? 0)) additions.push(`${path}: ${value} (${count})`);
    }
  }
  assert.deepEqual(additions, [], "Use the named tokens and type classes; new component exceptions:\n" + additions.join("\n"));
});

for (const { name, sweep } of CATEGORIES) {
  test(`${name}: off-scale count does not exceed the baseline (it only shrinks)`, () => {
    const offenders = sweep(css);
    const base = baseline[name];
    assert.ok(
      offenders.length <= base.count,
      `${name} off-scale count rose to ${offenders.length} (baseline ${base.count}). ` +
        `New off-scale literals:\n` +
        offenders
          .filter((o) => !base.values.includes(o.value))
          .map((o) => `  L${o.line}: ${o.value} — ${o.text}`)
          .join("\n") +
        `\nUse the ${name} scale token, or record a reduction by regenerating the baseline.`,
    );
    // No brand-new off-scale value string may appear (un-gameable against swaps).
    const novel = [...new Set(offenders.map((o) => o.value))].filter((v) => !base.values.includes(v));
    assert.deepEqual(novel, [], `${name}: new off-scale value(s) not in the baseline: ${novel.join(", ")}`);
  });
}
