/**
 * **THE BROWSER BUILD IS PINNED, AND A MISSING ONE IS A NAMED FAILURE.**
 * (`NH91`, item 7, 2026-08-23.)
 *
 * ## What went wrong, and what it looked like
 *
 * Playwright 1.62.1 wants Chromium build **1234**. The container image ships
 * **1194**. Three tests in `tests/beacon-guard.test.ts` therefore failed with
 *
 * > `browserType.launch: Executable doesn't exist at
 * > /opt/pw-browsers/chromium_headless_shell-1234/...`
 *
 * followed by Playwright's own advice to run `playwright install` — which this
 * environment cannot do, because the browser CDN is not reachable. **Nothing
 * in the repo said which build it needed**, so the version the harness wanted
 * and the version the image had were free to drift apart, and did.
 *
 * ## The three parts
 *
 * 1. **`playwright` is pinned to an EXACT version in `package.json`** — no
 *    caret. A caret range means an install can move the expected browser build
 *    without a single line of this repo changing, which is precisely how a
 *    build the image does not have becomes the build the harness demands.
 * 2. **`EXPECTED_CHROMIUM_REVISION` is committed here** and asserted against
 *    Playwright's own `browsers.json` by `tests/chromium-pin.test.ts`. A
 *    dependency bump that changes the browser now fails ONE test with a
 *    sentence saying so, instead of three tests with a stack trace each.
 * 3. **`resolveChromium()` resolves what is actually on disk.** Where the
 *    wanted build is absent and another complete Chromium is installed, it
 *    returns that binary's path and NAMES the substitution. Where nothing is
 *    installed at all, it returns a refusal carrying the directory it looked
 *    in — never silence, and never a skip.
 *
 * **A could-not-run is never a quiet skip.** That is the whole of `NH91`: a
 * test that cannot run is reported apart from a test that failed (RULING 24),
 * and neither is allowed to read like a pass.
 */
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * The Chromium build `playwright@1.62.1` ships against.
 *
 * Read from `node_modules/playwright-core/browsers.json` on 2026-08-23 and
 * committed so the expectation lives in the repo rather than only in a
 * lockfile nobody reads. `tests/chromium-pin.test.ts` re-reads that file and
 * fails if the two disagree.
 */
export const EXPECTED_CHROMIUM_REVISION = "1234";

/**
 * Only the two variables this reads. Narrower than `NodeJS.ProcessEnv` on
 * purpose: a test that wants to ask about a directory that does not exist
 * should not have to fabricate a whole environment to do it.
 */
export type BrowserEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where Playwright looks for browsers, honouring the environment's override.
 *
 * **`NH106`, 2026-08-23 — the default is PER PLATFORM, and assuming the POSIX
 * one is how this returned a directory that has never existed on Windows.**
 * Playwright's own default is `~/.cache/ms-playwright` on Linux,
 * `~/Library/Caches/ms-playwright` on macOS and `%LOCALAPPDATA%\ms-playwright`
 * on Windows. `HOME` is not even set on Windows, so the old single-line
 * fallback resolved to `\.cache\ms-playwright` off the process drive — a path
 * that cannot exist, read as "no browser installed".
 *
 * This is RULING 14's family: a path comparison may not assume a separator,
 * and a path CONSTRUCTION may not assume a filesystem layout.
 */
export function browsersRoot(env: BrowserEnv = process.env, platform: string = process.platform): string {
  const override = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (override) return override;
  if (platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(env.USERPROFILE ?? "", "AppData", "Local"), "ms-playwright");
  }
  const home = env.HOME ?? env.USERPROFILE ?? "";
  if (platform === "darwin") return join(home, "Library", "Caches", "ms-playwright");
  return join(home, ".cache", "ms-playwright");
}

/**
 * The binary inside one `chromium-<n>` build directory, or `undefined`.
 *
 * **`NH106`, 2026-08-23 — this is the defect that put `main` red, and the
 * shape of the fix is the whole lesson.** The old line was
 *
 * ```ts
 * const exe = join(root, entry, "chrome-linux", "chrome");
 * ```
 *
 * `chrome-linux/chrome` is Playwright's LEGACY layout. From the Chrome for
 * Testing packaging the binary is at `chrome-linux64/chrome` on Linux,
 * `chrome-win64/chrome.exe` on Windows and inside a `.app` bundle on macOS. So
 * the detector matched nothing on ANY platform with the pinned Playwright, and
 * CI reported `NO CHROMIUM INSTALLED. ... searched /home/runner/.cache/ms-playwright`
 * about a directory whose install log two screens earlier read
 * `Chrome for Testing 151.0.7922.34 ... downloaded to /home/runner/.cache/ms-playwright/chromium-1234`.
 * **The install was never the problem. The reader was.**
 *
 * A corrected hardcoded list would be the same defect with a longer life, so
 * nothing here predicts the directory's NAME. Playwright puts the binary under
 * exactly one `chrome-*` directory per build; this finds that directory and
 * looks for the platform's executable inside it, including through a macOS
 * `.app` bundle. A future repackaging that renames `chrome-linux64` again does
 * not break it.
 */
function executableIn(buildDir: string, platform: string = process.platform): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(buildDir);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.startsWith("chrome-")) continue;
    const dir = join(buildDir, entry);
    if (platform === "darwin") {
      /* The bundle name has changed too — `Chromium.app` in the legacy
       * packaging, `Google Chrome for Testing.app` in Chrome for Testing — so
       * the bundle is found rather than named. */
      let inner: string[];
      try {
        inner = readdirSync(dir);
      } catch {
        continue;
      }
      for (const app of inner) {
        if (!app.endsWith(".app")) continue;
        const macos = join(dir, app, "Contents", "MacOS");
        let bins: string[];
        try {
          bins = readdirSync(macos);
        } catch {
          continue;
        }
        for (const bin of bins) {
          const candidate = join(macos, bin);
          try {
            if (statSync(candidate).isFile()) return candidate;
          } catch {
            /* A dangling entry is not a browser. */
          }
        }
      }
      continue;
    }
    const exe = join(dir, platform === "win32" ? "chrome.exe" : "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export type ChromiumResolution =
  /**
   * The wanted build is installed. Playwright finds it unaided.
   *
   * `executablePath` is carried even though the launch does not need it, so a
   * test can compare this resolution against Playwright's own
   * `chromium.executablePath()`. That comparison is the drift check `NH106`
   * was missing: the two agreed on the DIRECTORY and disagreed on the binary
   * inside it, and nothing was asking.
   */
  | { kind: "EXPECTED"; revision: string; executablePath: string }
  /**
   * A DIFFERENT complete Chromium is installed and will be used by explicit
   * path. The substitution is named so a report can state it rather than
   * quietly claiming the pinned build ran.
   */
  | { kind: "SUBSTITUTED"; revision: string; executablePath: string }
  /**
   * Nothing usable is installed. The caller must fail, never skip.
   *
   * `sawBuildDirs` names the `chromium-<n>` directories that ARE there with no
   * binary found inside. `NH106` is exactly that case and the old message did
   * not have a word for it: CI said "NO CHROMIUM INSTALLED" about a directory
   * holding a freshly downloaded Chromium, so every reader of that line went
   * looking at the install step, which was fine. An absence that can name what
   * it did see points at the reader instead of the writer.
   */
  | { kind: "ABSENT"; searched: string; sawBuildDirs: string[] };

/**
 * Every complete Chromium under the browsers root, newest build first.
 *
 * `chromium-<n>` only — the headless-shell packages are a separate download
 * and a launch pointed at one of those is not the browser these tests drive.
 */
function installedChromiums(
  root: string,
  platform: string = process.platform,
): { revision: string; executablePath: string }[] {
  if (!existsSync(root)) return [];
  const out: { revision: string; executablePath: string }[] = [];
  for (const entry of readdirSync(root)) {
    const m = /^chromium-(\d+)$/.exec(entry);
    if (m === null) continue;
    const exe = executableIn(join(root, entry), platform);
    if (exe !== undefined) out.push({ revision: m[1], executablePath: exe });
  }
  return out.sort((a, b) => Number(b.revision) - Number(a.revision));
}

/**
 * What this machine can actually launch.
 *
 * Deliberately returns a VALUE rather than throwing: the caller decides
 * whether an absent browser is fatal, and every caller in this repo treats it
 * as fatal. Returning the state is what lets a report say *which* of the three
 * happened, which a thrown error at this depth cannot.
 */
export function resolveChromium(
  env: BrowserEnv = process.env,
  platform: string = process.platform,
): ChromiumResolution {
  const root = browsersRoot(env, platform);
  const installed = installedChromiums(root, platform);
  const expected = installed.find((c) => c.revision === EXPECTED_CHROMIUM_REVISION);
  if (expected !== undefined) {
    return {
      kind: "EXPECTED",
      revision: EXPECTED_CHROMIUM_REVISION,
      executablePath: expected.executablePath,
    };
  }
  const fallback = installed[0];
  if (fallback === undefined) {
    // Managed images can provide system Chromium without a Playwright cache.
    // Use only an explicitly selected executable, and report the substitution.
    const systemBrowser = env.WTP_CHROMIUM_EXECUTABLE?.trim();
    if (systemBrowser && isAbsolute(systemBrowser)) {
      try {
        accessSync(systemBrowser, constants.X_OK);
        if (statSync(systemBrowser).isFile()) return { kind: "SUBSTITUTED", revision: "system", executablePath: systemBrowser };
      } catch {
        // An unusable explicit path is still an absent browser, never a pass.
      }
    }
    let sawBuildDirs: string[] = [];
    try {
      sawBuildDirs = readdirSync(root).filter((e) => /^chromium-\d+$/.test(e));
    } catch {
      /* An unreadable root is the plain ABSENT case; the empty list says so. */
    }
    return { kind: "ABSENT", searched: root, sawBuildDirs };
  }
  return {
    kind: "SUBSTITUTED",
    revision: fallback.revision,
    executablePath: fallback.executablePath,
  };
}

/** One line, for a report or a console. Never silent about a substitution. */
export function describeChromium(r: ChromiumResolution): string {
  switch (r.kind) {
    case "EXPECTED":
      return `chromium ${r.revision} — the pinned build, installed`;
    case "SUBSTITUTED":
      return (
        `chromium ${r.revision} — SUBSTITUTED for the pinned ${EXPECTED_CHROMIUM_REVISION}, ` +
        `which is not installed. Launching ${r.executablePath}`
      );
    case "ABSENT": {
      /* The two cases read differently on purpose. An empty root is a missing
       * install; a root holding build directories with no binary found inside
       * is THIS code failing to read a browser that is sitting right there,
       * which is `NH106`. Sending both to the same sentence is what sent a
       * session to the install step for a defect in the reader. */
      const saw =
        r.sawBuildDirs.length > 0
          ? ` The root DOES hold ${r.sawBuildDirs.join(", ")} — a build directory with no binary found ` +
            "inside it means this resolver, not the install, is what failed."
          : " The root holds no chromium build directory at all; run `pnpm exec playwright install chromium`.";
      return (
        `NO CHROMIUM INSTALLED. Wanted build ${EXPECTED_CHROMIUM_REVISION}; searched ${r.searched}.${saw} ` +
        "Nothing that needs a browser can run, and nothing here may report a pass."
      );
    }
  }
}
