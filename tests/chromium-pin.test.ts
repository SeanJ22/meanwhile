import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EXPECTED_CHROMIUM_REVISION,
  browsersRoot,
  describeChromium,
  resolveChromium,
} from "../lib/ops/chromium-pin.ts";

const ROOT = join(import.meta.dirname, "..");

/**
 * **`NH91`, item 7, 2026-08-23 — the harness and the image may not drift
 * apart silently.**
 *
 * Three tests in `tests/beacon-guard.test.ts` died on
 * `Executable doesn't exist at .../chromium_headless_shell-1234/...` because
 * Playwright wanted build 1234 and the image shipped 1194. **Nothing in the
 * repo said which build it needed**, so there was no place the mismatch could
 * be noticed before three unrelated tests failed with a stack trace each.
 *
 * Two things are pinned and one is reported:
 *
 * - `playwright` is an EXACT version in `package.json`. A caret range means an
 *   install can move the wanted browser build with no diff in this repo.
 * - `EXPECTED_CHROMIUM_REVISION` is committed and checked against Playwright's
 *   own `browsers.json`, so a dependency bump that changes the browser fails
 *   HERE, by name, rather than three tests down.
 * - The resolution is printed on every run, so a substitution is stated rather
 *   than absorbed.
 */

test("playwright is pinned to an exact version, not a range", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const spec = pkg.devDependencies?.playwright ?? pkg.dependencies?.playwright;
  assert.ok(spec !== undefined, "playwright is not in package.json at all");
  assert.match(
    spec,
    /^\d+\.\d+\.\d+$/,
    `playwright must be an exact version so the browser build cannot move without a diff; saw "${spec}"`,
  );
});

test("the committed revision is the one playwright actually wants", () => {
  /*
   * Read from the installed package rather than hardcoded twice. A second
   * hardcoded copy is the duplicate-implementation class: it would agree with
   * the first forever, including after the first became wrong.
   */
  const pnpmDir = join(ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    assert.fail("node_modules/.pnpm is absent — run pnpm install before the suite");
  }
  const core = readdirSync(pnpmDir).find((d) => d.startsWith("playwright-core@"));
  assert.ok(core !== undefined, "playwright-core is not installed");
  const browsers = JSON.parse(
    readFileSync(join(pnpmDir, core, "node_modules", "playwright-core", "browsers.json"), "utf8"),
  ) as { browsers: { name: string; revision: string }[] };
  const chromium = browsers.browsers.find((b) => b.name === "chromium");
  assert.ok(chromium !== undefined, "playwright-core declares no chromium browser");
  assert.equal(
    chromium.revision,
    EXPECTED_CHROMIUM_REVISION,
    "playwright now wants a different Chromium build than lib/ops/chromium-pin.ts records. " +
      "Update EXPECTED_CHROMIUM_REVISION and confirm the image ships it, or the browser tests " +
      "will fail one by one with no statement of why.",
  );
});

test("the browser resolution is stated, never silent", (t) => {
  const resolved = resolveChromium();
  const line = describeChromium(resolved);
  // Printed on every run: a substitution that nobody is told about is the
  // drift this guard exists to end, wearing the fix's clothes.
  t.diagnostic(line);
  assert.ok(line.length > 20);
  assert.ok(
    resolved.kind !== "ABSENT",
    `${line}\nNothing that needs a browser can run on this machine.`,
  );
});

test("an absent browser refuses rather than reads as a pass", () => {
  const resolved = resolveChromium({
    PLAYWRIGHT_BROWSERS_PATH: join(ROOT, "no", "such", "directory"),
  });
  assert.equal(resolved.kind, "ABSENT");
  assert.match(describeChromium(resolved), /NO CHROMIUM INSTALLED/);
});

test("the browsers root honours the environment's override", () => {
  assert.equal(
    browsersRoot({ PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" }),
    "/opt/pw-browsers",
  );
});
