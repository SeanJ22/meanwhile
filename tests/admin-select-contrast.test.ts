import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * THE CONTROL-CENTRE DROPDOWNS ARE LEGIBLE IN DARK MODE.
 * (Control-centre resource-safety closure, 2026-09-04.)
 *
 * The admin surface is dark by default (`html { color-scheme: dark }` in
 * `app/globals.css`, light only under `[data-theme="light"]`). A native
 * `<select>` given no explicit surface renders its closed field and its option
 * popup in the UA's default (light) chrome even on a dark page — the reported
 * defect: the State Readiness dropdown opened light with near-invisible option
 * text. The fix pins every control-centre `<select>` and its `<option>`s to the
 * theme's own system colours (`Canvas`/`CanvasText`) and follows the inherited
 * `color-scheme` explicitly, so the two dropdowns (View, State) and the three
 * readiness controls (jurisdiction level, row filter, ZIP sort) all track dark
 * and light. These assertions read the scoped style strings as text so the fix
 * cannot silently regress; the actual dark/light render is verified in-browser.
 */

const ROOT = process.cwd();

function styleText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** A `<select>` rule that pins color-scheme, a themed background and text colour. */
function assertSelectIsThemed(src: string, where: string): void {
  // The select rule sets an explicit color-scheme (never relying on inheritance
  // of the native control chrome) and themed surface + text.
  // `[^}]` already spans newlines, so no dotAll flag is needed (or portable to
  // the type-check target). Each match is confined to a single rule block.
  assert.match(src, /select\b[^}]*color-scheme:\s*inherit/, `${where}: no explicit color-scheme on the select`);
  assert.match(src, /select\b[^}]*background-color:\s*Canvas/, `${where}: no themed background on the select`);
  assert.match(src, /select\b[^}]*color:\s*CanvasText/, `${where}: no themed text colour on the select`);
  // ...and the option popup gets the same treatment, because that is the part
  // that was rendering light on a dark page.
  assert.match(
    src,
    /select option\s*\{[^}]*background-color:\s*Canvas[^}]*color:\s*CanvasText/,
    `${where}: the <option> popup is not pinned to the theme colours`,
  );
}

test("the console-nav View and State dropdowns are theme-pinned (dark and light)", () => {
  assertSelectIsThemed(styleText("app/(admin)/layout.tsx"), "console-nav");
});

test("the readiness controls (level, rows, ZIP sort) are theme-pinned (dark and light)", () => {
  assertSelectIsThemed(styleText("app/(admin)/readiness/[state]/styles.ts"), "readiness controls");
});

test("POSITIVE CONTROL: stripping the themed surface fails the checker", () => {
  const stripped = styleText("app/(admin)/layout.tsx").replace(/background-color:\s*Canvas/g, "background: transparent");
  assert.ok(
    (() => {
      try {
        assertSelectIsThemed(stripped, "console-nav");
        return false;
      } catch {
        return true;
      }
    })(),
    "a select with no themed background passed the checker",
  );
});
