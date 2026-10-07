import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  civicDataReadNotInitialized,
  maySeedFixture,
  mayUseTestFixture,
  type CivicDataReadResult,
} from "../lib/civic-data/read-model.ts";

const metadata = {
  recordClass: "VOTING_SITE" as const,
  scope: "test",
  sourceId: null,
  version: null,
  versionId: null,
  lastKnownGoodVersionId: null,
  sourceThrough: null,
  retrievedAt: null,
  promotedAt: null,
  stale: "UNKNOWN" as const,
  staleAt: null,
};

test("tracked fixture seeding requires a test environment and a non-error authority state", () => {
  const notRecorded: CivicDataReadResult<never> = {
    kind: "NOT_RECORDED",
    value: null,
    metadata,
    detail: "no pointer",
  };
  const notInitialized = civicDataReadNotInitialized("VOTING_SITE", "test", "preload not called");
  const readFailed: CivicDataReadResult<never> = {
    kind: "STORE_UNREACHABLE",
    value: null,
    metadata,
    code: "STORE_READ_FAILED",
    detail: "store offline",
  };

  assert.equal(mayUseTestFixture({ NODE_ENV: "production" }), false);
  assert.equal(
    mayUseTestFixture({ NODE_ENV: "production", NODE_TEST_CONTEXT: "child-v8" }),
    false,
    "production wins even if a test-runner marker is accidentally inherited",
  );
  assert.equal(maySeedFixture(notRecorded, { NODE_ENV: "production" }), false);
  assert.equal(maySeedFixture(notRecorded, { NODE_ENV: "production", NODE_TEST_CONTEXT: "child-v8" }), false);
  assert.equal(maySeedFixture(notRecorded, { NODE_ENV: "test" }), true);
  assert.equal(maySeedFixture(notInitialized, { NODE_TEST_CONTEXT: "child-v8" }), true);
  assert.equal(maySeedFixture(readFailed, { NODE_ENV: "test" }), false);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  });
}

test("runtime Readers cannot improvise a NODE_TEST_CONTEXT fixture gate", () => {
  const root = join(import.meta.dirname, "..");
  const direct = [join(root, "app"), join(root, "lib")]
    .flatMap(sourceFiles)
    .filter((path) => !path.endsWith(join("lib", "civic-data", "firewall.ts")))
    .filter((path) => readFileSync(path, "utf8").includes("process.env.NODE_TEST_CONTEXT"))
    .map((path) => path.slice(root.length + 1).replaceAll("\\", "/"));
  assert.deepEqual(direct, []);
});
