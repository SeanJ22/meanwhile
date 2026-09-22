import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { parseShard, planTests } from "../scripts/ci-tests.mjs";
import { evaluate } from "../scripts/ci-verdict.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "scripts", "ci-tests.mjs");

function runnerEnvironment(shard: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_SHA: "", CI_TEST_SHARD: `${shard}/4` };
  // A synthetic CLI invocation is a new test runner, not this test's worker.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function fixture() {
  mkdirSync(join(ROOT, ".scratch", "ci"), { recursive: true });
  const root = mkdtempSync(join(ROOT, ".scratch", "ci", "shard-proof-"));
  mkdirSync(join(root, "tests", "nested"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  for (const file of ["package.json", "pnpm-lock.yaml", "tsconfig.json", "scripts/test-alias-loader.mjs"]) {
    copyFileSync(join(ROOT, file), join(root, file));
  }
  // Use the real loader and its installed TypeScript dependency in the parent tree.
  writeFileSync(join(root, "scripts", "register-test-loader.mjs"),
    `import ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "register-test-loader.mjs")).href)};\n`);
  const passing = `import test from 'node:test'; import assert from 'node:assert/strict'; test('real assertion', () => assert.equal(2 + 2, 4));\n`;
  for (const file of ["a.test.ts", "b.test.ts", "nested/c.test.ts", "nested/d.test.tsx"]) {
    writeFileSync(join(root, "tests", file), passing);
  }
  return root;
}

test("canonical TS and TSX discovery is covered exactly once with balanced deterministic partitions", () => {
  // Independently enumerate the suite rather than repeating the runner's glob.
  function discover(directory: string): string[] {
    return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? discover(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : [];
    });
  }
  const expected = discover("tests").sort();
  const plans = [1, 2, 3, 4].map((index) => planTests(ROOT, `${index}/4`));
  const all = plans.flatMap((plan) => plan.selected);
  assert.deepEqual([...all].sort(), expected);
  assert.equal(new Set(all).size, expected.length);
  assert.ok(all.some((file) => file.endsWith(".test.tsx")));
  assert.ok(Math.max(...plans.map((plan) => plan.selected.length)) - Math.min(...plans.map((plan) => plan.selected.length)) <= 1);
  for (const plan of plans) {
    assert.deepEqual(plan.args.slice(0, 4), ["--test", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"]);
    assert.deepEqual(plan, planTests(ROOT, `${plan.shard.index}/4`));
  }
});

test("missing, invalid and out-of-range shard configuration fails closed", () => {
  for (const value of [undefined, "", "0/4", "5/4", "1/0", "1/257", "1/4 extra", "01/4", "1.5/4", "1/9007199254740992"]) {
    assert.throws(() => parseShard(value));
  }
});

test("canonical command drift and an empty shard are refused", () => {
  const root = fixture();
  try {
    assert.throws(() => planTests(root, "1/5"), /empty shard/);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const command of ["node --test tests/**/*.test.ts", `${pkg.scripts.test} --test-name-pattern=passing`, `${pkg.scripts.test} && echo success`]) {
      writeFileSync(join(root, "package.json"), JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, test: command } }));
      assert.throws(() => planTests(root, "1/4"), /Canonical package scripts.test changed/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a hosted SHA different from the checked-out commit cannot certify a shard", () => {
  const root = fixture();
  try {
    const result = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: { ...runnerEnvironment(1), GITHUB_SHA: "0".repeat(40) }, encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match GITHUB_SHA/);
    assert.doesNotMatch(result.stdout, /real assertion/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a terminated test process cannot become a successful shard", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "scripts", "register-test-loader.mjs"), "process.kill(process.pid, 'SIGTERM');\n");
    const result = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(1), encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 1, result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, ".scratch", "ci", "test-shard-1-of-4.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.notEqual(manifest.exitCode, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an affected TSX assertion is selected, executed and propagates failure with durable diagnostics", () => {
  const root = fixture();
  try {
    const affected = "tests/nested/d.test.tsx";
    writeFileSync(join(root, affected), `import test from 'node:test'; import assert from 'node:assert/strict'; test('affected-contract-proof', () => assert.equal(2 + 2, 5));\n`);
    const plan = planTests(root, "1/4");
    const shard = plan.assignments.find((entry: { file: string }) => entry.file === affected)!.shard;
    const result = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(shard), encoding: "utf8", timeout: 30_000, windowsHide: true });
    const testResult = result.status === 0 ? "success" : "failure";
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /affected-contract-proof/);
    const requiredVerdict = evaluate({
      admission: { result: "success", outputs: { tier: "yes" } },
      verify: { result: "success" },
      build: { result: "success" },
      test: { result: testResult },
    });
    assert.equal(requiredVerdict.ok, false, "the executed failing shard must block the PR's final reducer");
    assert.match(requiredVerdict.reasons.join("\n"), /test: failure/);
    const stem = join(root, ".scratch", "ci", `test-shard-${shard}-of-4`);
    const manifest = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.exitCode, 1);
    assert.deepEqual(manifest.selected, [affected]);
    assert.equal(manifest.assignments.length, 4);
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    assert.match(manifest.configHash, /^[a-f0-9]{64}$/);
    assert.match(manifest.suiteHash, /^[a-f0-9]{64}$/);
    assert.match(readFileSync(`${stem}.log`, "utf8"), /affected-contract-proof/);
    // The same real command becomes green only after the failing assertion is fixed.
    writeFileSync(join(root, affected), `import test from 'node:test'; import assert from 'node:assert/strict'; test('affected-contract-proof', () => assert.equal(2 + 2, 4));\n`);
    const passed = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(shard), encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(passed.status, 0, passed.stderr);
    const green = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
    assert.equal(green.status, "passed");
    assert.notEqual(green.suiteHash, manifest.suiteHash);
    assert.equal(green.configHash, manifest.configHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
