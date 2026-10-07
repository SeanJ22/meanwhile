import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".github", "workflows");

// actions/checkout and actions/setup-node majors from v5 declare `using: node24`.
const FIRST_NODE24_MAJOR = 5;

// Anchored on `- uses:` so a version named in a comment is never counted as a pin.
const ACTION_PIN = /-\s*uses:\s*actions\/(checkout|setup-node)@v(\d+)/g;

// The step, not the word: a comment may mention corepack.
const COREPACK_STEP = /run:\s*corepack enable/;

const SETUP_NODE_STEP = /-\s*uses:\s*actions\/setup-node@/;

const workflows = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

test("the workflow set covers CI and release observation", () => {
  assert.deepEqual(workflows.sort(), ["build-check.yml", "post-deploy-integrity.yml"]);
});

test("R45: no workflow pins an action major that targets Node 20", () => {
  const stale: string[] = [];
  let pins = 0;

  for (const file of workflows) {
    const source = readFileSync(join(DIR, file), "utf8");
    for (const match of source.matchAll(ACTION_PIN)) {
      pins += 1;
      if (Number(match[2]) < FIRST_NODE24_MAJOR) {
        stale.push(`${file}: actions/${match[1]}@v${match[2]}`);
      }
    }
  }

  assert.equal(
    pins,
    12, // five CI jobs and the post-deploy observer, two pins each
    `expected 12 Node-runtime action pins across the active workflow set, found ${pins}`,
  );
  assert.deepEqual(
    stale,
    [],
    "these pins target Node 20 and will be forced onto a runtime they were not " +
      `built for: ${stale.join(", ")}`,
  );
});

test("R45: setup-node never tries to restore a cache before pnpm exists", () => {
  const unguarded: string[] = [];

  for (const file of workflows) {
    const source = readFileSync(join(DIR, file), "utf8");
    if (!SETUP_NODE_STEP.test(source)) continue;

    const setupNodeAt = source.search(SETUP_NODE_STEP);
    const corepackAt = source.search(COREPACK_STEP);

    assert.ok(
      corepackAt > setupNodeAt,
      `${file}: corepack enable no longer follows setup-node — re-rule on package-manager-cache`,
    );

    if (!/package-manager-cache:\s*false/.test(source)) unguarded.push(file);
  }

  assert.deepEqual(
    unguarded,
    [],
    `setup-node may auto-cache pnpm before corepack installs it in: ${unguarded.join(", ")}`,
  );
});
