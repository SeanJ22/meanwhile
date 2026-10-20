import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Plain .mjs, shared with the plain-node scripts that never see tsx.
import { posixRelative, toPosix } from "../scripts/repo-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A repo-relative path is POSIX, normalized once where it is produced (`scripts/repo-path.mjs`) and compared as
 * POSIX everywhere. This guard catches turning a POSIX literal into platform separators and a backslash used as a
 * separator in a repo-path literal. It cannot catch a comparison that forgot to normalize; allowlists should
 * assert that every entry binds to a file the sweep walks.
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

/** Strips comments, which name the banned patterns while explaining them. */
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

test("no path is inverted from POSIX into platform separators", () => {
  // Source-text patterns, so the guard does not depend on the separator it polices.
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

test("no repo-path literal uses a backslash as its separator", () => {
  // Anchored on the repo's top-level directories so an escaped backslash in a regex or iCal text is not swept up.
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

test("the shared normalizer exists and normalizes both directions", () => {
  // Built rather than written: a Windows-separator path literal is what the test above bans.
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

test("a state holding path compares the same on both platforms", () => {
  assert.equal(toPosix("data\\states\\wi\\ballot\\wi-dane-2028.json"), "data/states/wi/ballot/wi-dane-2028.json");
});

/**
 * A URL pathname is not a filesystem path: on Windows `new URL(import.meta.url).pathname` is `/C:/...`, which
 * `join()` resolves against the working directory. Invisible on Linux. `fileURLToPath` is the decoder.
 */
test("no file URL is used as a path without fileURLToPath", () => {
  // Assembled from pieces so this guard does not match itself.
  const BANNED = new RegExp(String.raw`new URL\([^)]*\)\.` + "pathname");

  // These parse network URL components, never filesystem paths; each exception is expression-exact.
  const URL_COMPONENT_ONLY = new Map<string, readonly [string, number]>([
    ["lib/officials/federal-directory-data-plane.ts", [["new URL(row.finalUrl)", "pathname"].join("."), 1]],
    ["lib/civic-data/derived-meeting-wiring.ts", [["new URL(input.route)", "pathname"].join("."), 1]],
    // The Census downloader takes only the final HTTPS path segment for its cache filename.
    ["scripts/fetch-districts.ts", [["new URL(url)", "pathname"].join("."), 1]],
    // The live-write guard compares a browser request's HTTPS path against the write routes.
    ["lib/ops/live-write-guard.ts", [["new URL(requestUrl)", "pathname"].join("."), 1]],
    // The President profile has passed own-page HTTPS validation; this builds a source ID.
    ["lib/sources/white-house/president.ts", [["new URL(page.url)", "pathname"].join("."), 1]],
    // Browser resource paths check HTTP request counts and scope, never filesystem paths.
    ["scripts/rs-02-browser-check.mjs", [["new URL(resource.name)", "pathname"].join("."), 3]],
  ]);

  const offenders: string[] = [];
  for (const abs of sourceFiles()) {
    const rel = posixRelative(ROOT, abs);
    let code = codeOnly(readFileSync(abs, "utf8"));
    const [urlComponentOnly, expectedOccurrences] = URL_COMPONENT_ONLY.get(rel) ?? [];
    if (urlComponentOnly !== undefined) {
      const occurrences = code.split(urlComponentOnly).length - 1;
      assert.equal(
        occurrences,
        expectedOccurrences,
        `${rel} must carry exactly ${expectedOccurrences} reviewed URL-component-only expression(s); saw ${occurrences}`,
      );
      code = code.replaceAll(urlComponentOnly, "");
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

// The denominator: the sanctioned decoder should be in wide use, or the sweep is reading the wrong tree.
test("the sanctioned file-URL decoder is the established idiom", () => {
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
