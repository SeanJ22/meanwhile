import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative, toPosix } from "../scripts/repo-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * RULING 14 (Prompt B item 1d, 2026-08-20) — a path comparison may not assume
 * a separator.
 *
 * `tests/coverage-manifest.test.ts` shipped on 2026-08-18 mapping a POSIX
 * allowlist through `.replace(/\//g, "\\")` and comparing it against
 * `relative()`. On the author's Windows machine every entry matched; on every
 * Linux runner none did, so the offender list contained `lib/coverage/states.ts`
 * — the manifest the allowlist exists to exempt. Local dev is Windows; CI and
 * production are Linux. F22 fixed that one file. This is the class.
 *
 * THE RULE, in the form the repo can hold: a repo-relative path is POSIX,
 * normalized once where it is produced, compared as POSIX everywhere.
 * `scripts/repo-path.mjs` is the one implementation.
 *
 * WHAT THIS GUARD REACHES, stated rather than implied — a guard whose limits
 * are unstated reads as broader than it is, which is the defect one floor up:
 *
 *   - It CATCHES the inversion: turning a POSIX literal into platform
 *     separators (`replace(/\//g, "\\")`, `replace(/\//g, sep)`,
 *     `split("/").join(sep)`). That direction is always wrong, because the
 *     literal was already the comparable form.
 *   - It CATCHES a backslash used as a separator inside a repo-path literal.
 *   - It does NOT reach a comparison that merely forgot to normalize, because
 *     "this string is a path" is not decidable from source. `tests/coverage-
 *     manifest.test.ts` carries the complementary guard for that shape: it
 *     asserts every allowlist entry BINDS to a file the sweep actually walks,
 *     so an exemption list that silently matches nothing fails by name. New
 *     allowlists should carry the same binding assertion.
 */

const SWEPT_ROOTS = ["app", "components", "hooks", "lib", "scripts", "tests"];
const SOURCE = /\.(ts|tsx|mts|mjs|js)$/;

/** The one sanctioned normalizer, exempt from the literal ban it enforces. */
const NORMALIZER = "scripts/repo-path.mjs";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Comments explain the rule constantly in this repo — the header above names
 * the banned pattern three times. Stripping them is what keeps an explanation
 * from reading as a violation.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SWEPT_ROOTS) files.push(...walk(join(ROOT, root)));
  return files;
}

test("the sweep reaches the source tree it claims to", () => {
  const files = sourceFiles();
  assert.ok(
    files.length > 300,
    `expected the whole source tree, found ${files.length} files — a sweep that ` +
      "found nothing must not read as a sweep that found nothing wrong",
  );
});

test("RULING 14: no path is inverted from POSIX into platform separators", () => {
  // Each written as a source-text pattern rather than a path operation, so
  // the guard cannot itself depend on the separator it is policing.
  const INVERSIONS: Array<[RegExp, string]> = [
    [/\.replace\(\s*\/\\\/\/g\s*,\s*(?:"\\\\\\\\"|'\\\\\\\\'|sep)\s*\)/, "replace(/\\//g, <platform separator>)"],
    [/\.split\(\s*["']\/["']\s*\)\s*\.join\(\s*sep\s*\)/, 'split("/").join(sep)'],
    [/\.split\(\s*["']\/["']\s*\)\s*\.join\(\s*path\.sep\s*\)/, 'split("/").join(path.sep)'],
  ];

  const offenders: string[] = [];
  for (const abs of sourceFiles()) {
    const rel = posixRelative(ROOT, abs);
    const code = codeOnly(readFileSync(abs, "utf8"));
    for (const [pattern, label] of INVERSIONS) {
      if (pattern.test(code)) offenders.push(`${rel}: ${label}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these turn a comparable POSIX path into a platform-specific one — the shape " +
      "that allowlisted fourteen files on Windows and none on Linux. Normalize " +
      `with posixRelative from ${NORMALIZER} and compare as POSIX.`,
  );
});

test("RULING 14: no repo-path literal uses a backslash as its separator", () => {
  // A repo path written with backslashes only ever compares equal on one
  // platform. Anchored on the repo's own top-level directories so an escaped
  // backslash inside a regex or an iCal escape is not swept up.
  const DIRS = SWEPT_ROOTS.join("|");
  const BACKSLASH_PATH = new RegExp(`["'\`](?:\\.\\.?\\\\\\\\)?(?:${DIRS})\\\\\\\\[a-z]`, "i");

  const offenders: string[] = [];
  for (const abs of sourceFiles()) {
    const rel = posixRelative(ROOT, abs);
    if (rel === NORMALIZER) continue;
    const code = codeOnly(readFileSync(abs, "utf8"));
    if (BACKSLASH_PATH.test(code)) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    "these hold a repo path written with backslashes — it can only ever match on Windows",
  );
});

test("RULING 14: the shared normalizer exists and normalizes both directions", () => {
  // Built rather than written, because a Windows-separator path literal is
  // exactly what the test above bans — and a guard that has to exempt itself
  // is a guard with a hole shaped like its own fixture.
  const WIN_SEP = String.fromCharCode(92);
  const windowsPath = ["lib", "coverage", "states.ts"].join(WIN_SEP);
  assert.equal(toPosix(windowsPath), "lib/coverage/states.ts");
  assert.equal(
    toPosix("lib/coverage/states.ts"),
    "lib/coverage/states.ts",
    "already-POSIX input is left alone, so it is safe to apply twice",
  );
  assert.equal(
    posixRelative(join(ROOT, "lib"), join(ROOT, "lib", "coverage", "states.ts")),
    "coverage/states.ts",
    "a repo-relative path comes back POSIX on every platform",
  );
});

/**
 * The specific regression RULING 14 names. `AUD-06` is gated by
 * `tests/coverage-manifest.test.ts`, and while its allowlist was
 * separator-broken the offender list contained the manifest itself. This
 * asserts the outcome directly rather than trusting the fix upstream.
 */
test("RULING 14: a state holding path compares the same on both platforms", () => {
  assert.equal(toPosix("data\\states\\wi\\ballot\\wi-dane-2028.json"), "data/states/wi/ballot/wi-dane-2028.json");
});

/**
 * **`NH106`, 2026-08-23 — RULING 14's family: a URL PATHNAME IS NOT A
 * FILESYSTEM PATH.**
 *
 * `new URL(import.meta.url).pathname` returns a URL component, and on Windows
 * that component is `/C:/Users/seanj/dev/we-the-people/scripts` — leading
 * slash, drive letter inside. Feed it to `join(..., "..")` and the result is
 * relative-looking, so it resolves against the working directory and produces
 *
 * ```
 * C:\C:\Users\seanj\dev\we-the-people\data\ballot\nj-morris-2026.json
 * ```
 *
 * which is what `pnpm test` threw on before this guard existed. It is invisible
 * on Linux, where the pathname happens to be a valid absolute path, so CI is
 * structurally unable to catch it — the same asymmetry RULING 14 was adopted
 * over, pointing the other way.
 *
 * Four files carried it, all four written the same day, while some forty other
 * files in the same directory used `fileURLToPath`. That is the class shape:
 * not one mistake, one HABIT, and a habit needs a guard rather than four edits.
 *
 * `fileURLToPath` is the decoder — it strips the leading slash, handles the
 * drive letter, and percent-decodes a path containing a space, which the
 * pathname form also gets wrong and which nobody would notice until this repo
 * lived under a directory with a space in its name.
 */
test("RULING 14: no file URL is used as a path without fileURLToPath", () => {
  /*
   * Assembled from pieces rather than written as one literal, for the reason
   * the guards above are: a text-scanning guard written the obvious way
   * matches ITSELF, and the first run of this one duly reported this file as
   * the only offender in the repo. The pattern reaches the pathname of ANY URL
   * built from a file URL, not only `import.meta.url` — a variable holding one
   * is the same defect under a different name, and this guard exists because
   * the shape was a habit rather than a slip.
   */
  const BANNED = new RegExp(String.raw`new URL\([^)]*\)\.` + "pathname");

  /*
   * These expressions parse acquired HTTPS routes, never file URLs. The
   * downloader takes only the final segment as a cache filename. Keep each
   * exception expression-exact: exempting the file would also hide a later
   * import.meta.url pathname defect in the same acquisition module.
   */
  const URL_COMPONENT_ONLY = new Map<string, string>([
    ["lib/officials/federal-directory-data-plane.ts", ["new URL(row.finalUrl)", "pathname"].join(".")],
    ["lib/civic-data/derived-meeting-wiring.ts", ["new URL(input.route)", "pathname"].join(".")],
    // The Census downloader takes only the final HTTPS path segment for its cache filename.
    ["scripts/fetch-districts.ts", ["new URL(url)", "pathname"].join(".")],
    // The live-write guard compares a browser request's HTTPS path against the write routes.
    ["lib/ops/live-write-guard.ts", ["new URL(requestUrl)", "pathname"].join(".")],
  ]);

  const offenders: string[] = [];
  for (const abs of sourceFiles()) {
    const rel = posixRelative(ROOT, abs);
    let code = codeOnly(readFileSync(abs, "utf8"));
    const urlComponentOnly = URL_COMPONENT_ONLY.get(rel);
    if (urlComponentOnly !== undefined) {
      const occurrences = code.split(urlComponentOnly).length - 1;
      assert.equal(
        occurrences,
        1,
        `${rel} must carry exactly one reviewed URL-component-only expression; saw ${occurrences}`,
      );
      code = code.replace(urlComponentOnly, "");
    }
    if (BANNED.test(code)) {
      offenders.push(`${rel}: a file URL component used as a filesystem path`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a URL pathname is not a filesystem path: on Windows it is `/C:/...`, which " +
      "join() then resolves against the working directory into `C:\C:\...`. " +
      "Use fileURLToPath from node:url, as the rest of scripts/ already does.",
  );
});

/**
 * The denominator for the guard above, stated rather than implied.
 *
 * A ban is only worth what the population it swept is worth, and this one is
 * cheap to state: the sanctioned decoder should be in wide use, so a run where
 * it has almost vanished means the sweep is looking at the wrong tree rather
 * than that the repo got cleaner.
 */
test("RULING 14: the sanctioned file-URL decoder is the established idiom", () => {
  let users = 0;
  for (const abs of sourceFiles()) {
    if (/fileURLToPath\(/.test(codeOnly(readFileSync(abs, "utf8")))) users += 1;
  }
  assert.ok(
    users > 30,
    `only ${users} file(s) use fileURLToPath — expected it to be the established ` +
      "idiom across scripts/. A collapse here means this sweep is not reaching the tree.",
  );
});
