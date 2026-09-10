import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const EXPECTED_CALLERS = [
  "lib/civic-data/manual-read-models.ts",
  "lib/civic-data/state-members.ts",
  "lib/corpus/data-plane.ts",
  "lib/funding/snapshot.ts",
  "lib/officials/executive-actions.ts",
  "lib/officials/federal-directory-read-model.ts",
  "lib/outcomes/store.ts",
  "lib/reference/acs-population.ts",
  "lib/registry/runtime-read-model.ts",
  "lib/sources/ballot-nj-morris/index.ts",
  "lib/votes/key-votes-projection.ts",
  "lib/votes/snapshot.ts",
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

test("the meetings aggregate keeps its custom fixture boundary explicit and production-closed", () => {
  const source = readFileSync(join(ROOT, "lib/meetings/snapshot.ts"), "utf8");
  assert.match(source, /\breadSnapshot\(options\.root\)/);
  assert.match(source, /\bmayUseTestFixture\(\)/);
  assert.match(
    source,
    /process\.env\.NODE_ENV\s*!==\s*["']production["']\s*&&\s*\(options\.allowUnconfiguredBootstrap\s*\?\?\s*mayUseTestFixture\(\)\)/,
  );
  assert.match(source, /storeFailure\s*&&\s*!fixtureEligible/);
});

test("literal bootstrap permission exists only behind the two explicit node-test branches", () => {
  const literalTrue = EXPECTED_CALLERS.filter((path) =>
    /allowUnconfiguredBootstrap\s*:\s*true/.test(readFileSync(join(ROOT, path), "utf8")),
  );
  assert.deepEqual(literalTrue, [
    "lib/officials/executive-actions.ts",
    "lib/outcomes/store.ts",
  ]);
  for (const path of literalTrue) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.match(source, /mayUseTestFixture\(\)/);
    assert.match(source, /readPromotedCivicData/, `${path} production must bypass the bootstrap helper entirely`);
  }
});

test("the shared selector makes production bootstrap impossible even if a caller asks for it", () => {
  const source = readFileSync(join(ROOT, "lib/civic-data/read-model.ts"), "utf8");
  assert.match(
    source,
    /options\.allowUnconfiguredBootstrap\s*===\s*true\s*&&\s*process\.env\.NODE_ENV\s*!==\s*["']production["']/,
  );
});
