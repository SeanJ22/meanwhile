import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { sourceFilesUnder } from "./read-code.ts";

/**
 * Control-centre dropdowns are legible in dark mode: every `<select>` and its `<option>`s are pinned
 * to system colours (`Canvas`/`CanvasText`) under an explicit `color-scheme`, so the popup is drawn
 * in the page's scheme.
 *
 * ```
 *   app/(admin)/layout.tsx                  selects follow the page's dark or light theme
 *   app/(admin)/_mw/admin-v6/v6.module.css  the redesigned shell; always dark, selects pinned dark
 * ```
 */

const ROOT = process.cwd();

function styleText(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** A `<select>` rule that follows the page's theme: an explicit inherited color-scheme, a themed background and text colour. */
function assertSelectIsThemed(src: string, where: string): void {
  // `[^}]` spans newlines, so each match stays inside one rule block.
  assert.match(src, /select\b[^}]*color-scheme:\s*inherit/, `${where}: no explicit color-scheme on the select`);
  assert.match(src, /select\b[^}]*background-color:\s*Canvas/, `${where}: no themed background on the select`);
  assert.match(src, /select\b[^}]*color:\s*CanvasText/, `${where}: no themed text colour on the select`);
  // ...and the option popup gets the same treatment.
  assert.match(
    src,
    /select option\s*\{[^}]*background-color:\s*Canvas[^}]*color:\s*CanvasText/,
    `${where}: the <option> popup is not pinned to the theme colours`,
  );
}

/** The shell's select: pinned dark, a Canvas surface under its light text, and the popup pinned to the same scheme. */
function assertShellSelectIsDark(css: string, where: string): void {
  const rule = /(^|\n)\.legacySelect\s*\{([^}]*)\}/.exec(css)?.[2] ?? "";
  assert.ok(rule.length > 0, `${where}: no .select rule`);
  assert.match(rule, /color-scheme:\s*dark/, `${where}: the select does not pin the dark scheme, so its popup can open light`);
  assert.match(rule, /background-color:\s*Canvas/, `${where}: no scheme surface under the select`);
  assert.match(rule, /(^|[;\s])color:\s*var\(--mw-text\)/, `${where}: the select's text is not the shell's light text`);
  assert.match(
    css,
    /\.legacySelect option,\s*\.legacySelect optgroup\s*\{[^}]*background-color:\s*Canvas[^}]*color:\s*CanvasText/,
    `${where}: the <option> popup is not pinned to the scheme colours`,
  );
}

test("the kept pages' selects are theme-pinned (dark and light)", () => {
  assertSelectIsThemed(styleText("app/(admin)/layout.tsx"), "console stylesheet");
});

test("the redesigned shell's selects are pinned dark, and every select it draws carries that rule", () => {
  assertShellSelectIsDark(styleText("app/(admin)/_mw/admin-v6/v6.module.css"), "shell stylesheet");
  // A select that does not carry the class falls back to the UA's chrome.
  const drawn: string[] = [];
  for (const abs of sourceFilesUnder([".tsx"], "app", "(admin)", "_mw")) {
    const source = readFileSync(abs, "utf8");
    for (const m of source.matchAll(/<select\b[^>]*>/g)) {
      drawn.push(m[0]);
      assert.match(m[0], /className=\{[^}]*\bs\.select\b/, `a shell select without the shell's select rule: ${m[0].slice(0, 80)}`);
    }
  }
  assert.ok(drawn.length >= 2, `the sweep must reach the scope select and the composer's pickers; saw ${drawn.length}`);
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

test("POSITIVE CONTROL: a shell select that stops pinning the dark scheme fails the checker", () => {
  const unpinned = styleText("app/(admin)/_mw/admin-v6/v6.module.css").replace(/(\n\.legacySelect\s*\{[^}]*?)color-scheme:\s*dark;/, "$1");
  assert.notEqual(unpinned, styleText("app/(admin)/_mw/admin-v6/v6.module.css"), "the control must actually remove the declaration");
  assert.throws(() => assertShellSelectIsDark(unpinned, "shell"), /does not pin the dark scheme/);
});
