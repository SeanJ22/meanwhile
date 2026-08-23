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
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

/** Where Playwright looks for browsers, honouring the environment's override. */
export function browsersRoot(env: BrowserEnv = process.env): string {
  return env.PLAYWRIGHT_BROWSERS_PATH?.trim() || join(env.HOME ?? "", ".cache", "ms-playwright");
}

export type ChromiumResolution =
  /** The wanted build is installed. Playwright finds it unaided. */
  | { kind: "EXPECTED"; revision: string }
  /**
   * A DIFFERENT complete Chromium is installed and will be used by explicit
   * path. The substitution is named so a report can state it rather than
   * quietly claiming the pinned build ran.
   */
  | { kind: "SUBSTITUTED"; revision: string; executablePath: string }
  /** Nothing usable is installed. The caller must fail, never skip. */
  | { kind: "ABSENT"; searched: string };

/**
 * Every complete Chromium under the browsers root, newest build first.
 *
 * `chromium-<n>` only — the headless-shell packages are a separate download
 * and a launch pointed at one of those is not the browser these tests drive.
 */
function installedChromiums(root: string): { revision: string; executablePath: string }[] {
  if (!existsSync(root)) return [];
  const out: { revision: string; executablePath: string }[] = [];
  for (const entry of readdirSync(root)) {
    const m = /^chromium-(\d+)$/.exec(entry);
    if (m === null) continue;
    const exe = join(root, entry, "chrome-linux", "chrome");
    if (existsSync(exe)) out.push({ revision: m[1], executablePath: exe });
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
export function resolveChromium(env: BrowserEnv = process.env): ChromiumResolution {
  const root = browsersRoot(env);
  const installed = installedChromiums(root);
  if (installed.some((c) => c.revision === EXPECTED_CHROMIUM_REVISION)) {
    return { kind: "EXPECTED", revision: EXPECTED_CHROMIUM_REVISION };
  }
  const fallback = installed[0];
  if (fallback === undefined) return { kind: "ABSENT", searched: root };
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
    case "ABSENT":
      return (
        `NO CHROMIUM INSTALLED. Wanted build ${EXPECTED_CHROMIUM_REVISION}; searched ${r.searched}. ` +
        "Nothing that needs a browser can run, and nothing here may report a pass."
      );
  }
}
