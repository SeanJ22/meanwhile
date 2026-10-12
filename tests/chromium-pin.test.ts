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
  // Read from the installed package rather than hardcoded twice.
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

test("what this repo resolves is the file playwright would actually launch", async () => {
  const resolved = resolveChromium();
  if (resolved.kind === "ABSENT") {
    assert.fail(`${describeChromium(resolved)}\nNothing that needs a browser can run on this machine.`);
  }
  if (resolved.kind === "SUBSTITUTED") {
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
