import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * THE AMBER REMNANT (item 10, 2026-08-16, the author's ruling).
 *
 * The brown-dies pass moved the interactive accent to azure through three
 * tokens — `--link`, `--action`, `--signal` — and that was the whole of it.
 * Every rule that had been written against `--accent-local` DIRECTLY kept the
 * amber: the page's focus ring, every icon button's hover, the search input's
 * focus border, the autocomplete's selection highlight and match bold, the
 * scope and filter selects, the count badges, the notice FAB, the filter
 * chips and their counter, and — the loudest one — the WELCOME OVERLAY'S
 * SUBMIT BUTTON, which is the first filled control a reader ever sees.
 *
 * And `--tier-fill-local` in the light theme was `#6d4600`: the dead
 * interactive brown's own hex, left behind on the selected Local toggle. It
 * was invisible to every guard because no test measured a tier fill.
 *
 * Two rules, and the second is why the first one is checkable at all:
 *
 * 1. `--accent-local` is a TIER token. It may only be read where the tier is
 *    the meaning — the token aliases, the map pins. Never by a hover, a
 *    focus, a selection, or a filled action.
 * 2. The tier toggle's fill is MEASURED, in both themes, by `pnpm contrast`.
 *    A fill nobody measures is a fill nobody notices.
 */

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");

/**
 * Where the tier accent is genuinely the meaning. Each entry is a whole
 * declaration, so a new rule cannot slip in by matching a prefix.
 */
const TIER_SEMANTIC = [
  "--tier-fill-local: var(--accent-local);",
  "--color-local: var(--accent-local);",
  "background: var(--pin-color, var(--accent-local));",
  "0 0 14px var(--pin-glow, var(--accent-local-glow));",
  "0 0 0 5px var(--pin-color, var(--accent-local)),",
  "0 0 20px var(--pin-glow, var(--accent-local-glow));",
];

test("the interactive accent is azure everywhere — no rule reads the tier amber", () => {
  const offenders: string[] = [];
  for (const line of CSS.split(/\r?\n/)) {
    if (!/var\(--accent-local(-glow)?\)/.test(line)) continue;
    const trimmed = line.trim();
    if (TIER_SEMANTIC.includes(trimmed)) continue;
    offenders.push(trimmed);
  }
  assert.deepEqual(
    offenders,
    [],
    "the tier amber is being read where the tier is not the meaning:\n" +
      offenders.join("\n"),
  );
});

test("the dead interactive brown is gone from every token, both themes", () => {
  // #6d4600 was the light theme's old `--link`. It survived as the selected
  // Local toggle's fill, which is exactly what the author reported seeing.
  assert.ok(
    !/#6d4600/i.test(CSS.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the dead interactive brown is still a live value somewhere",
  );
});

test("every tier toggle's fill is on the measured list", () => {
  // The reason the remnant survived a whole palette pass: nothing measured
  // it. `pnpm contrast` reads the stylesheet, so this guard checks the audit
  // asks about all three fills rather than trusting that it does.
  const audit = readFileSync(join(ROOT, "scripts", "contrast-audit.mts"), "utf8");
  for (const fill of [
    "--tier-fill-local",
    "--tier-fill-state",
    "--tier-fill-national",
  ]) {
    assert.ok(
      new RegExp(`text: "--tier-fill-on", on: "${fill}"|on: "${fill}"`).test(audit),
      `${fill} is not measured by the contrast audit`,
    );
  }
});

test("the toggle and the legend are one colour per tier — the coupling, literally", () => {
  // Dark already filled with the accent itself. Light now fills with a bright
  // version of the same hue carrying dark text, rather than a near-black tint
  // carrying near-white text — so the control a reader taps and the key to
  // the map are the same colour for the same tier.
  const light = CSS.slice(CSS.indexOf('[data-theme="light"]'));
  const localFill = /--tier-fill-local:\s*(#[0-9a-f]{6})/i.exec(light)?.[1];
  const onColor = /--tier-fill-on:\s*(#[0-9a-f]{6})/i.exec(light)?.[1];
  assert.ok(localFill && onColor);
  // The fill is light and the text on it is dark — the dark theme's strategy.
  const lum = (hex: string) => {
    const v = hex.replace("#", "");
    const c = (n: number) => {
      const s = n / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * c(parseInt(v.slice(0, 2), 16)) +
      0.7152 * c(parseInt(v.slice(2, 4), 16)) +
      0.0722 * c(parseInt(v.slice(4, 6), 16))
    );
  };
  assert.ok(
    lum(localFill) > lum(onColor),
    "the light tier fill must be the bright side of the pair, as in dark",
  );
});
