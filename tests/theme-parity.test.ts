import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { themeParityGaps, isLiteralColor } from "../lib/design/theme-parity.ts";

const ROOT = join(import.meta.dirname, "..");
const GLOBALS = join(ROOT, "app", "globals.css");

test("the parity classifier reads literal vs derived correctly (RULING 110)", () => {
  assert.equal(isLiteralColor("#1a1a2e"), true);
  assert.equal(isLiteralColor("rgba(0,0,0,0.3)"), true);
  assert.equal(isLiteralColor("var(--link)"), false, "an alias inherits theme variance");
  assert.equal(
    isLiteralColor("color-mix(in srgb, var(--link) 55%, var(--text-muted))"),
    false,
    "a derivation over tokens is not a literal",
  );
  assert.equal(isLiteralColor("999px"), false, "a dimension is not a colour");

  const planted =
    ":root {\n  --x: #123456;\n  --shared: #222222;\n}\n" +
    '[data-theme="light"] {\n  --shared: #eeeeee;\n  --y: #ffffff;\n}\n';
  const gaps = themeParityGaps(planted);
  assert.equal(gaps.darkOnly.length, 1, "a dark-only literal colour must be flagged");
  assert.equal(gaps.darkOnly[0].name, "--x");
  assert.equal(gaps.lightOnly.length, 1, "a light-only literal colour must be flagged");
});

test("app/globals.css authors every literal colour in both themes", () => {
  const css = readFileSync(GLOBALS, "utf8") + "\n" + readFileSync(join(ROOT, "app", "reader.css"), "utf8");
  const { darkOnly, lightOnly } = themeParityGaps(css);
  assert.deepEqual(
    darkOnly,
    [],
    "literal colours in :root with no [data-theme=\"light\"] override:\n" +
      darkOnly.map((t) => `  ${t.name} = ${t.value}`).join("\n"),
  );
  assert.deepEqual(
    lightOnly,
    [],
    "literal colours in [data-theme=\"light\"] with no :root declaration:\n" +
      lightOnly.map((t) => `  ${t.name} = ${t.value}`).join("\n"),
  );
});
