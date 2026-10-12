/** The browser build is pinned, and a missing one is a named failure, never a skip. */
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** The Chromium build the pinned Playwright ships against; a test re-reads `browsers.json` and fails on drift. */
export const EXPECTED_CHROMIUM_REVISION = "1234";

/**
 * Only the two variables this reads. Narrower than `NodeJS.ProcessEnv` on
 * purpose: a test that wants to ask about a directory that does not exist
 * should not have to fabricate a whole environment to do it.
 */
export type BrowserEnv = Readonly<Record<string, string | undefined>>;

/** Where Playwright looks for browsers, honouring the override; the default differs per platform. */
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

/** The binary inside one `chromium-<n>` build directory, or undefined; handles both legacy and Chrome for Testing layouts. */
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
      /* The bundle name differs between packagings, so the bundle is found rather than named. */
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
  /** The wanted build is installed. `executablePath` is carried so a test can compare it with Playwright's own. */
  | { kind: "EXPECTED"; revision: string; executablePath: string }
  /**
   * A DIFFERENT complete Chromium is installed and will be used by explicit
   * path. The substitution is named so a report can state it rather than
   * quietly claiming the pinned build ran.
   */
  | { kind: "SUBSTITUTED"; revision: string; executablePath: string }
  /** Nothing usable is installed; the caller must fail. `sawBuildDirs` names build directories found with no binary inside. */
  | { kind: "ABSENT"; searched: string; sawBuildDirs: string[] };

/** Every complete Chromium under the browsers root, newest build first; headless-shell packages are excluded. */
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

/** What this machine can launch, returned as a value so a report can say which case happened. */
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
      /* An empty root is a missing install; build directories with no binary found are a failure of this reader. */
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
