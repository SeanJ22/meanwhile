import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/*
 * ---------------------------------------------------------------------------
 * `NH106` (2026-08-23) — THE GUARDS THAT WOULD HAVE CAUGHT `main` GOING RED.
 *
 * The four failures at `3d453fd` were one defect: `resolveChromium()` looked
 * for the binary at `chrome-linux/chrome`, Playwright's LEGACY layout, while
 * the pinned Playwright downloads Chrome for Testing to `chrome-linux64/chrome`.
 * CI reported `NO CHROMIUM INSTALLED ... searched /home/runner/.cache/ms-playwright`
 * about a directory its own install log said it had put a Chromium in.
 *
 * Everything above this line passed throughout. The pin was checked, the
 * exactness of the version was checked, the refusal-on-absence was checked —
 * and not one of them compared what this repo resolves against what Playwright
 * itself would launch, which is the only comparison that could have failed.
 * ---------------------------------------------------------------------------
 */

test("what this repo resolves is the file playwright would actually launch", async () => {
  const resolved = resolveChromium();
  if (resolved.kind === "ABSENT") {
    assert.fail(`${describeChromium(resolved)}\nNothing that needs a browser can run on this machine.`);
  }
  if (resolved.kind === "SUBSTITUTED") {
    /* A stated substitution is the deliberate case: the pinned build is absent
     * and another is launched by explicit path. The two SHOULD differ there,
     * and asserting equality would turn a working fallback into a failure. */
    return;
  }
  const { chromium } = await import("playwright");
  assert.equal(
    resolved.executablePath,
    chromium.executablePath(),
    "this repo's resolver and playwright disagree about which binary is the pinned build. " +
      "They agreed on the DIRECTORY and disagreed on the file inside it for as long as this pin " +
      "existed, which is how a green install step and a red suite coexisted at 3d453fd.",
  );
});

test("a chrome-for-testing layout is found on every platform, not just the legacy one", () => {
  /*
   * The fixture is a real directory tree rather than a mock, because the
   * defect was `existsSync` returning false for a path that was never going to
   * exist. A mocked filesystem would have agreed with the bug.
   *
   * Both packagings per platform: `chrome-linux64` is Chrome for Testing and
   * `chrome-linux` is what Playwright shipped before it, and a machine can
   * hold either. Nothing here predicts the directory NAME — that is the point
   * of the fix, so the test states the names it expects to be tolerant of and
   * the code finds them by shape.
   */
  const cases: { platform: string; layout: string; binary: string }[] = [
    { platform: "linux", layout: "chrome-linux64", binary: "chrome" },
    { platform: "linux", layout: "chrome-linux", binary: "chrome" },
    { platform: "win32", layout: "chrome-win64", binary: "chrome.exe" },
    { platform: "win32", layout: "chrome-win", binary: "chrome.exe" },
  ];

  for (const c of cases) {
    const root = mkdtempSync(join(tmpdir(), "wtp-chromium-"));
    try {
      const dir = join(root, `chromium-${EXPECTED_CHROMIUM_REVISION}`, c.layout);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, c.binary), "");
      const resolved = resolveChromium({ PLAYWRIGHT_BROWSERS_PATH: root }, c.platform);
      assert.equal(
        resolved.kind,
        "EXPECTED",
        `${c.platform} ${c.layout}/${c.binary} was not recognised as an installed browser — ` +
          `describeChromium said: ${describeChromium(resolved)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a build directory with no binary in it blames the reader, not the installer", () => {
  /*
   * `NH106`'s message defect, guarded. CI said "NO CHROMIUM INSTALLED" about a
   * root holding `chromium-1234`, so every reader of that line went and looked
   * at the install step, which was working perfectly. An absence that can name
   * what it DID see points at the right half of the problem.
   */
  const root = mkdtempSync(join(tmpdir(), "wtp-chromium-"));
  try {
    mkdirSync(join(root, `chromium-${EXPECTED_CHROMIUM_REVISION}`, "chrome-mars99"), {
      recursive: true,
    });
    const resolved = resolveChromium({ PLAYWRIGHT_BROWSERS_PATH: root }, "linux");
    assert.equal(resolved.kind, "ABSENT");
    const line = describeChromium(resolved);
    assert.match(line, new RegExp(`chromium-${EXPECTED_CHROMIUM_REVISION}`));
    assert.match(line, /this resolver, not the install, is what failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the browsers root default is per platform, and windows has no HOME", () => {
  /*
   * The sibling defect found in the same file, and it is RULING 14's family:
   * the fallback was `join(env.HOME ?? "", ".cache", "ms-playwright")` on every
   * platform. `HOME` is not set on Windows, so that resolved to a `.cache`
   * directory off the process drive — a path that has never existed — and the
   * resolver was therefore wrong on the author's own machine too, for a second
   * independent reason, the whole time.
   */
  assert.equal(
    browsersRoot({ HOME: "/home/runner" }, "linux"),
    join("/home/runner", ".cache", "ms-playwright"),
  );
  assert.equal(
    browsersRoot({ HOME: "/Users/x" }, "darwin"),
    join("/Users/x", "Library", "Caches", "ms-playwright"),
  );
  assert.equal(
    browsersRoot({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32"),
    join("C:\\Users\\x\\AppData\\Local", "ms-playwright"),
  );
  assert.equal(
    browsersRoot({ USERPROFILE: "C:\\Users\\x" }, "win32"),
    join("C:\\Users\\x", "AppData", "Local", "ms-playwright"),
  );
  assert.ok(
    !browsersRoot({ USERPROFILE: "C:\\Users\\x" }, "win32").includes(".cache"),
    "the windows default must not be the POSIX one",
  );
});


test("an explicit system browser is a stated substitution, never an installed pinned build", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-system-chromium-"));
  try {
    const executable = join(root, "system-chromium");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const env = { PLAYWRIGHT_BROWSERS_PATH: join(root, "missing-cache"), WTP_CHROMIUM_EXECUTABLE: executable };
    const result = resolveChromium(env);
    assert.deepEqual(result, { kind: "SUBSTITUTED", revision: "system", executablePath: executable });
    assert.match(describeChromium(result), /SUBSTITUTED/);
    assert.equal(resolveChromium({ ...env, WTP_CHROMIUM_EXECUTABLE: root }).kind, "ABSENT");
    assert.equal(resolveChromium({ ...env, WTP_CHROMIUM_EXECUTABLE: join(root, "missing") }).kind, "ABSENT");
    assert.equal(resolveChromium({ ...env, WTP_CHROMIUM_EXECUTABLE: "relative-browser" }).kind, "ABSENT");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
