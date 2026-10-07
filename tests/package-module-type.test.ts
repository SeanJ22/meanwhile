import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// One normalizer, so an offender list reads identically on Windows and on Linux.
import { posixRelative } from "../scripts/repo-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// `"type": "module"` changes the meaning of `.js` and `.ts` only. A `.js` or `.cjs` file is reported, not
// forbidden: written as CommonJS it fails at run time under this field.

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
  // `require`, `module.exports`, `__dirname` and `__filename` do not exist in an ES module.
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
      // This file carries every pattern below as a literal.
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
