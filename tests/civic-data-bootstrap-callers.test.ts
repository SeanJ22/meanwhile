import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const EXPECTED_CALLERS = [
  "lib/census-geography/reader.ts",
  "lib/civic-data/state-members.ts",
] as const;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|mts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1).replaceAll("\\", "/");
}

test("every bundled-bootstrap caller is enumerated and keeps an explicit fixture gate", () => {
  const call = /\breadPromotedOrBootstrap(?:<[^>]+>)?\s*\(/;
  const callers = sourceFiles(join(ROOT, "lib"))
    .filter((path) => relative(path) !== "lib/civic-data/read-model.ts")
    .filter((path) => call.test(readFileSync(path, "utf8")))
    .map(relative)
    .sort();
  assert.deepEqual(callers, [...EXPECTED_CALLERS].sort(), "a bootstrap caller was added or removed without auditing its production boundary");

  for (const path of callers) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.match(source, /allowUnconfiguredBootstrap\s*(?::|,)/, `${path} does not make its non-production fixture intent explicit`);
  }
});

test("the shared selector makes production bootstrap impossible even if a caller asks for it", () => {
  const source = readFileSync(join(ROOT, "lib/civic-data/read-model.ts"), "utf8");
  assert.match(
    source,
    /options\.allowUnconfiguredBootstrap\s*===\s*true\s*&&\s*process\.env\.NODE_ENV\s*!==\s*["']production["']/,
  );
});
