/**
 * The sun test, as a number.
 *
 *   pnpm contrast
 *
 * The tester's field finding, 2026-08-15: gold-on-light is unreadable in
 * phone glare. That is not a WCAG failure — it is a WCAG *pass* that means
 * nothing outdoors, because the standard's 4.5:1 was calibrated for a screen
 * you can see. Direct sun raises the black level of a phone display by more
 * than the whole contrast budget of a 4.5:1 pair.
 *
 * So this repo carries two bars, and the second one is the real one:
 *
 * - **4.5:1** — WCAG AA for body text. Necessary, never sufficient here.
 * - **7:1** — the SUN bar, WCAG AAA's number used for a different reason.
 *   Every reader-facing text token must clear it against the surface it
 *   actually renders on, in BOTH themes.
 *
 * Reads the tokens straight out of `app/globals.css` rather than a copy, so
 * it cannot drift from what ships. Run it after any palette change; a pair
 * below the sun bar is reported and exits non-zero.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

const AA = 4.5;
const SUN = 7;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = srgbToLinear((n >> 16) & 255);
  const g = srgbToLinear((n >> 8) & 255);
  const b = srgbToLinear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Token values for one theme block. `:root` is dark; `[data-theme="light"]`
 * overrides a subset, so light inherits everything it does not restate —
 * which is exactly how the stylesheet behaves and exactly the trap a
 * hand-maintained copy of this table would fall into.
 */
function tokensIn(selector: string): Map<string, string> {
  // Anchored at a line start, because both selector strings also appear in
  // this stylesheet's own header comment — the first attempt matched the
  // COMMENT, so the light block was never read and light reported dark's
  // numbers with a straight face. A parser that finds the wrong thing and
  // says nothing is the empty-success shape, in a script whose whole job is
  // to catch things.
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block at a line start`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("\n}", open);
  const block = css.slice(open, close);
  const out = new Map<string, string>();
  for (const m of block.matchAll(
    /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}|var\(\s*--[a-z0-9-]+\s*\))\s*;/g,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** `--link: var(--accent-local)` has to become a colour before it can be
 *  measured. One hop is all the stylesheet uses; more would be a smell. */
function resolve(tokens: Map<string, string>): Map<string, string> {
  const out = new Map(tokens);
  for (const [key, value] of tokens) {
    const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
    if (!alias) continue;
    const target = tokens.get(alias[1]);
    if (target && target.startsWith("#")) out.set(key, target);
    else out.delete(key);
  }
  return out;
}

const darkRaw = tokensIn(":root");
const lightRaw = new Map(darkRaw);
for (const [k, v] of tokensIn('[data-theme="light"]')) lightRaw.set(k, v);
const dark = resolve(darkRaw);
const light = resolve(lightRaw);

// The parse must not silently read one block twice — that is exactly the bug
// this script shipped with for ten minutes.
if (dark.get("--bg") === light.get("--bg")) {
  throw new Error("light and dark parsed to the same --bg; the block anchor is wrong");
}

/** Text token → the surfaces it actually renders on. */
const PAIRS: { text: string; on: string[]; note: string }[] = [
  { text: "--text", on: ["--bg", "--panel", "--panel-bg"], note: "body copy and data" },
  { text: "--text-dim", on: ["--bg", "--panel", "--panel-bg"], note: "secondary rows" },
  { text: "--voice", on: ["--bg", "--panel", "--panel-bg"], note: "the app's guidance register" },
  { text: "--link", on: ["--bg", "--panel", "--panel-bg"], note: "the one interactive accent" },
  { text: "--label", on: ["--bg", "--panel", "--panel-bg"], note: "structural labels" },
  { text: "--danger", on: ["--bg", "--panel"], note: "failures" },
];

/** Filled controls: the text colour sits ON the accent, not on the page. */
const FILLED: { text: string; on: string; note: string }[] = [
  { text: "--action-on", on: "--action", note: "the primary filled action" },
];

/**
 * Deliberately NOT held to the sun bar, each with its reason. A list, not an
 * absence — an exemption nobody can see is how a bar quietly stops meaning
 * anything.
 */
const EXEMPT: Record<string, string> = {
  "--text-muted":
    "pure metadata (separators, timestamps). Never carries guidance or record; a reader who cannot read it has lost nothing.",
  "--accent-state":
    "structure only — dots, rules, tier marks. Held to 3:1 as a non-text token, never used for reading text.",
  "--accent-national": "structure only, as above.",
  "--accent-school": "structure only, as above.",
};

let failures = 0;
const rows: string[] = [];

function check(label: string, value: number, bar: number) {
  const ok = value >= bar;
  if (!ok) failures += 1;
  rows.push(
    `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} ${value.toFixed(2)}:1 (bar ${bar})`,
  );
}

for (const [themeName, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  rows.push(`\n${themeName}`);
  for (const pair of PAIRS) {
    const fg = tokens.get(pair.text);
    if (!fg) {
      rows.push(`  ??   ${pair.text} — not defined in ${themeName}`);
      failures += 1;
      continue;
    }
    for (const surface of pair.on) {
      const bg = tokens.get(surface);
      if (!bg) continue;
      check(`${pair.text} on ${surface}`, ratio(fg, bg), SUN);
    }
  }
  for (const pair of FILLED) {
    const fg = tokens.get(pair.text);
    const bg = tokens.get(pair.on);
    if (!fg || !bg) {
      rows.push(`  ??   ${pair.text} on ${pair.on} — not defined in ${themeName}`);
      failures += 1;
      continue;
    }
    // A filled control is a large, bold, isolated target. AA is the right bar
    // for it, and stating that here is what keeps it from drifting to "we
    // just lowered the bar for the thing that failed".
    check(`${pair.text} on ${pair.on}`, ratio(fg, bg), AA);
  }
}

console.log("Contrast audit — the sun bar is 7:1, AA is 4.5:1");
console.log(rows.join("\n"));
console.log("\nexempt, with reasons:");
for (const [token, why] of Object.entries(EXEMPT)) {
  console.log(`  ${token} — ${why}`);
}
console.log(
  `\n${failures === 0 ? "all pairs clear their bar" : `${failures} pair(s) below bar`}`,
);
if (failures > 0) process.exit(1);
