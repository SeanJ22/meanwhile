import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// RULING 14: one normalizer, so an offender list reads identically on
// Windows and on Linux.
import { posixRelative } from "../scripts/repo-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * R46 (2026-08-18) — `"type": "module"`, and the enumeration that made it safe.
 *
 * Node printed MODULE_TYPELESS_PACKAGE_JSON once per test file on every run —
 * 112 warnings around the output the refresh gate is read from. Node's own
 * remedy is `"type": "module"`, which is not a warning suppression: it changes
 * how every extension-ambiguous file in the package is interpreted. The row
 * required that be evaluated rather than reflexed.
 *
 * The evaluation, and the reason the ripple was small: the ONLY extensions
 * whose meaning this field changes are `.js` and `.ts`. This package contains
 * no `.js` and no `.cjs` files at all — all 22 of its JavaScript files are
 * `.mjs`, which is unconditionally ESM either way — and every `.ts`/`.tsx`
 * file in it is already written as ESM (no `require(`, no `__dirname`, no
 * `__filename` anywhere in tracked source). So the field flipped `.ts` from
 * "ambiguous, reparse and warn" to "ESM", which is what those files already
 * were, and flipped nothing else.
 *
 * That enumeration is the load-bearing part, so it is asserted here rather
 * than written down and trusted. A `.js` or `.cjs` file added later is not
 * forbidden by this test — it is REPORTED by it, because under `type: module`
 * a plain `.js` file written as CommonJS fails at run time, and whoever adds
 * one needs to have decided that on purpose.
 *
 * Measured: 112 warnings before, 0 after, 968 tests passing both ways.
 */

const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  type?: string;
};

// Directories that are not the package's own source: dependencies, build
// output, and the gitignored session scratch that tsconfig also excludes.
const NOT_OURS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".scratch",
  ".netlify",
  "playwright-report",
  "test-results",
]);

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (NOT_OURS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(js|cjs)$/.test(entry.name)) found.push(posixRelative(ROOT, full));
  }
  return found;
}

test("R46: the package declares itself ESM", () => {
  assert.equal(
    PACKAGE.type,
    "module",
    "package.json lost its type field — MODULE_TYPELESS_PACKAGE_JSON returns, " +
      "112 warnings deep, around the output the refresh gate is read from",
  );
});

test("R46: no ambiguous-extension JavaScript file has appeared", () => {
  const ambiguous = walk(ROOT);

  assert.deepEqual(
    ambiguous,
    [],
    "a .js or .cjs file appeared in a package declared ESM. Under " +
      '"type": "module" a plain .js file is parsed as ESM, so a CommonJS one ' +
      "throws at run time rather than at build time. Decide its fate on " +
      `purpose: rename it .mjs (ESM) or .cjs (CommonJS). Found: ${ambiguous.join(", ")}`,
  );
});

test("R46: tracked source carries no CommonJS-only construct", () => {
  /*
    The other half of the enumeration. `require`, `module.exports`,
    `__dirname` and `__filename` do not exist in an ES module, so any of them
    appearing in a `.ts`/`.tsx`/`.mts`/`.mjs` file is a run-time failure this
    field created. Checked at the time of the change and asserted since.
  */
  const offenders: string[] = [];

  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_OURS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs)$/.test(entry.name)) continue;
      // This file is the scanner. It carries every pattern below as a regex
      // literal and names them again in prose, so scanning it finds four
      // offenders in a clean tree — which is exactly what the first run did.
      if (entry.name === "package-module-type.test.ts") continue;
      const source = readFileSync(full, "utf8");
      // Word-boundary anchored so `moduleResolution`, `requireAuth` and prose
      // about the rule do not read as uses of it.
      if (/(^|[^.\w])require\s*\(/.test(source)) {
        offenders.push(`${posixRelative(ROOT, full)}: require(`);
      }
      if (/(^|[^.\w])__dirname\b/.test(source)) {
        offenders.push(`${posixRelative(ROOT, full)}: __dirname`);
      }
      if (/(^|[^.\w])__filename\b/.test(source)) {
        offenders.push(`${posixRelative(ROOT, full)}: __filename`);
      }
      if (/(^|[^.\w])module\.exports\b/.test(source)) {
        offenders.push(`${posixRelative(ROOT, full)}: module.exports`);
      }
    }
  }
  scan(ROOT);

  assert.deepEqual(
    offenders,
    [],
    "these do not exist in an ES module and will throw at run time under " +
      `"type": "module". Use import / import.meta.url instead: ${offenders.join(", ")}`,
  );
});
