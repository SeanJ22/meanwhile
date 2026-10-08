import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { parseShard, parseTestFiles, partitionTests, planExplicitTests, planTests, testFileConcurrency } from "../scripts/ci-tests.mjs";
import { evaluate } from "../scripts/ci-verdict.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(ROOT, "scripts", "ci-tests.mjs");

function runnerEnvironment(shard: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_SHA: "", CI_TEST_SHARD: `${shard}/4` };
  // A synthetic CLI invocation is a new test runner, not this test's worker,
  // and it must not inherit the parent run's affected-file selection.
  delete env.NODE_TEST_CONTEXT;
  delete env.CI_TEST_FILES;
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
  // The runner preloads the doors the suite reads; this small repository has none to install.
  mkdirSync(join(root, "tests", "helpers"));
  writeFileSync(join(root, "tests", "helpers", "install-fixture-doors.ts"), "export {};\n");
  const passing = `import test from 'node:test'; import assert from 'node:assert/strict'; test('real assertion', () => assert.equal(2 + 2, 4));\n`;
  for (const file of ["a.test.ts", "b.test.ts", "nested/c.test.ts", "nested/d.test.tsx"]) {
    writeFileSync(join(root, "tests", file), passing);
  }
  return root;
}

test("canonical TS and TSX discovery is covered exactly once with balanced deterministic partitions", () => {
  function discover(directory: string): string[] {
    return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? discover(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : [];
    });
  }
  const expected = [...discover("tests"), ...discover("lib/sources/platform-adapters")].sort();
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

test("measured longest-first hints balance file counts without omitting new or unmeasured files", () => {
  const files = ["a", "b", "c", "d", "e", "f", "new"].map((name) => `tests/${name}.test.ts`);
  const hints = { formatVersion: 1, source: "synthetic scheduling fixture, not production weights",
    durationMsByFile: { "tests/a.test.ts": 100, "tests/b.test.ts": 80, "tests/c.test.ts": 30, "tests/d.test.ts": 20 } };
  const plan = partitionTests(files, 3, hints);
  assert.deepEqual(plan, partitionTests([...files].reverse(), 3, hints), "input order cannot change assignments");
  assert.deepEqual(plan.assignments.map((row) => row.file), files);
  assert.deepEqual([1, 2, 3].map((index) => plan.assignments.filter((row) => row.shard === index).length), [3, 2, 2]);
  assert.ok(plan.scheduling.model.selectedMakespanCost <= plan.scheduling.model.roundRobinMakespanCost);
  assert.equal(plan.scheduling.unknownFiles, 3);
  assert.equal(plan.assignments.find((row) => row.file === files[6])?.hintDurationMs, null);
  assert.equal(plan.assignments.find((row) => row.file === files[6])?.schedulingCost, 100);
  assert.equal(plan.scheduling.estimateBasis, "measured-p95-with-1ms-floor");
  const known = partitionTests(files.slice(0, 4), 2, hints, 2);
  assert.deepEqual(known.assignments.map((row) => row.shard), [1, 2, 1, 2], "equal lexical makespans deterministically retain round-robin");
});

test("lexical dispatch modeling rejects an LPT regression and bounded swaps cannot worsen round-robin", () => {
  function simulate(assignments: { file: string; shard: number; schedulingCost: number }[], count: number, workers: number) {
    const load = Array.from({ length: count }, () => Array(workers).fill(0));
    for (const row of [...assignments].sort((a, b) => a.file < b.file ? -1 : 1)) {
      const shard = load[row.shard - 1];
      shard[shard.indexOf(Math.min(...shard))] += row.schedulingCost;
    }
    return Math.max(...load.flat());
  }
  const values = [4, 10, 1, 6, 13, 3, 8, 4];
  const files = values.map((_, index) => `tests/${String.fromCharCode(97 + index)}.test.ts`);
  const hints = { formatVersion: 1, source: "synthetic lexical-dispatch regression fixture",
    durationMsByFile: Object.fromEntries(files.map((file, index) => [file, values[index]])) };
  const plan = partitionTests(files, 2, hints, 2);
  assert.equal(plan.scheduling.model.roundRobinMakespanCost, 14);
  assert.equal(plan.scheduling.model.longestFirstMakespanCost, 15);
  assert.equal(plan.scheduling.model.initialPlan, "round-robin");
  assert.equal(plan.scheduling.model.selectedMakespanCost, simulate(plan.assignments, 2, 2));
  assert.ok(plan.scheduling.model.selectedMakespanCost <= 14);
  assert.equal(plan.scheduling.model.label, "ESTIMATE");
  assert.deepEqual(plan, partitionTests([...files].reverse(), 2, hints, 2));
  assert.deepEqual(plan.assignments.map((row) => row.file), files);
  assert.deepEqual([1, 2].map((shard) => plan.assignments.filter((row) => row.shard === shard).length), [4, 4]);
  for (const workers of [1, 2]) {
    const current = partitionTests(files, 3, hints, workers);
    assert.equal(current.scheduling.model.selectedMakespanCost, simulate(current.assignments, 3, workers));
    assert.ok(current.scheduling.model.selectedMakespanCost <= current.scheduling.model.roundRobinMakespanCost);
    assert.deepEqual([1, 2, 3].map((shard) => current.assignments.filter((row) => row.shard === shard).length), [3, 3, 2]);
    assert.ok(current.scheduling.model.swapsAccepted <= 8);
    assert.ok(current.scheduling.model.evaluatedSwaps <= 8 * 2 * 32 * 32);
  }
});

test("missing and invalid hints fall back to deterministic complete count balancing", () => {
  const files = ["a", "b", "c", "d", "e"].map((name) => `tests/${name}.test.tsx`);
  const empty = { formatVersion: 1, source: null, durationMsByFile: {} };
  const expected = partitionTests(files, 2, empty).assignments;
  assert.deepEqual(expected.map((row) => row.shard), [1, 2, 1, 2, 1]);
  assert.ok(expected.every((row) => row.hintDurationMs === null && row.schedulingCost === 1));
  const zero = partitionTests(files, 2, { ...empty, source: "synthetic zero-duration fixture",
    durationMsByFile: Object.fromEntries(files.map((file) => [file, 0])) });
  assert.deepEqual(zero.assignments.map((row) => row.shard), [1, 2, 1, 2, 1]);
  assert.equal(zero.scheduling.model.swapsAccepted, 0);
  for (const hints of [null, {}, { ...empty, formatVersion: 2 },
    { ...empty, durationMsByFile: { [files[0]]: 10 } },
    ...[-1, NaN, Infinity, "12"].map((duration) => ({ ...empty, source: "fixture", durationMsByFile: { [files[0]]: duration } }))]) {
    const actual = partitionTests(files, 2, hints);
    assert.deepEqual(actual.assignments, expected);
    assert.equal(actual.scheduling.hintsValid, false);
  }
  assert.throws(() => partitionTests([files[0], files[0]], 2, empty), /unique/);
});

test("file processes use two workers without oversubscribing one-core runners", () => {
  assert.deepEqual([1, 2, 3, 32].map(testFileConcurrency), [1, 2, 2, 2]);
  for (const available of [0, -1, Infinity, 1.5]) assert.throws(() => testFileConcurrency(available));
  const plan = planTests(ROOT, "1/4");
  assert.equal(plan.concurrency.effective, testFileConcurrency(plan.concurrency.available));
  assert.equal(plan.scheduling.model.workers, plan.concurrency.effective);
  assert.ok(!plan.args.some((arg) => /force-exit|isolation=none|test-name-pattern/.test(arg)));
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
      env: { ...runnerEnvironment(1), GITHUB_SHA: "0".repeat(40) }, encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match GITHUB_SHA/);
    assert.doesNotMatch(result.stdout, /real assertion/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a terminated test process cannot become a successful shard", () => {
  const root = fixture();
  try {
    const baseline = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(1), encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(baseline.status, 0, baseline.stderr);
    writeFileSync(join(root, "scripts", "register-test-loader.mjs"), "process.kill(process.pid, 'SIGTERM');\n");
    const result = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(1), encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(result.status, 1, result.stderr);
    const manifest = JSON.parse(readFileSync(join(root, ".scratch", "ci", "test-shard-1-of-4.json"), "utf8"));
    assert.equal(manifest.status, "failed");
    assert.notEqual(manifest.exitCode, 0);
    assert.equal(manifest.timing.complete, false);
    assert.equal(manifest.timing.usableForScheduling, false);
    assert.ok(manifest.timing.issues.length > 0, "a bootstrap failure must not inherit the previous invocation's successful timing records");
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
      env: runnerEnvironment(shard), encoding: "utf8", timeout: 120_000, windowsHide: true });
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
    assert.equal(manifest.timing.complete, true);
    assert.equal(manifest.timing.usableForScheduling, false, "complete timing never turns failed verification into a performance baseline");
    assert.deepEqual(manifest.timing.files.map((row: { file: string }) => row.file), [affected]);
    assert.ok(manifest.configInputs.includes("scripts/ci-test-timing-reporter.mjs"));
    assert.ok(manifest.configInputs.includes("scripts/ci-test-scheduling-hints.mjs"));
    assert.ok(manifest.invocationArgs.includes(`--test-concurrency=${manifest.concurrency.effective}`));
    assert.equal(manifest.runner.platform, process.platform);
    assert.equal(manifest.runner.arch, process.arch);
    assert.ok(manifest.runner.totalMemoryBytes > 0);
    assert.match(readFileSync(`${stem}.log`, "utf8"), /affected-contract-proof/);
    writeFileSync(join(root, affected), `import test from 'node:test'; import assert from 'node:assert/strict'; test('affected-contract-proof', () => assert.equal(2 + 2, 4));\n`);
    const passed = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: runnerEnvironment(shard), encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(passed.status, 0, passed.stderr);
    const green = JSON.parse(readFileSync(`${stem}.json`, "utf8"));
    assert.equal(green.status, "passed");
    assert.equal(green.timing.complete, true);
    assert.equal(green.timing.usableForScheduling, true);
    assert.notEqual(green.suiteHash, manifest.suiteHash);
    assert.equal(green.configHash, manifest.configHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("actual reporter and hint code changes invalidate the recorded configuration hash", () => {
  const root = fixture();
  try {
    for (const file of ["ci-tests.mjs", "ci-test-timing-reporter.mjs", "ci-test-scheduling-hints.mjs"]) {
      copyFileSync(join(ROOT, "scripts", file), join(root, "scripts", file));
    }
    const run = () => {
      const result = spawnSync(process.execPath, [join(root, "scripts", "ci-tests.mjs")], {
        cwd: root, env: runnerEnvironment(1), encoding: "utf8", timeout: 120_000, windowsHide: true,
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(readFileSync(join(root, ".scratch", "ci", "test-shard-1-of-4.json"), "utf8"));
    };
    const before = run();
    const reporter = join(root, "scripts", "ci-test-timing-reporter.mjs");
    writeFileSync(reporter, `${readFileSync(reporter, "utf8")}\n// fixture-only configuration change\n`);
    const changedReporter = run();
    assert.notEqual(changedReporter.configHash, before.configHash);
    const hints = join(root, "scripts", "ci-test-scheduling-hints.mjs");
    writeFileSync(hints, `${readFileSync(hints, "utf8")}\n// fixture-only scheduling change\n`);
    const changedHints = run();
    assert.notEqual(changedHints.configHash, changedReporter.configHash);
    assert.equal(changedHints.suiteHash, before.suiteHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an explicit affected-file list runs exactly those files with the same flags, identity and timing proof", () => {
  const root = fixture();
  try {
    const plan = planExplicitTests(root, "tests/nested/d.test.tsx\ntests/a.test.ts\n");
    assert.equal(plan.mode, "explicit");
    assert.deepEqual(plan.selected, ["tests/a.test.ts", "tests/nested/d.test.tsx"]);
    assert.deepEqual(plan.args.slice(0, 4), ["--test", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"]);
    assert.deepEqual(plan.assignments.map((row: { file: string; shard: number }) => [row.file, row.shard]),
      [["tests/a.test.ts", 1], ["tests/nested/d.test.tsx", 1]]);

    const affected = "tests/b.test.ts";
    writeFileSync(join(root, affected), `import test from 'node:test'; import assert from 'node:assert/strict'; test('explicit-list-proof', () => assert.equal(2 + 2, 5));\n`);
    const env = { ...runnerEnvironment(1), CI_TEST_SHARD: "", CI_TEST_FILES: `${affected}\n` };
    const failed = spawnSync(process.execPath, [RUNNER], { cwd: root, env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stdout, /Affected tests: 1\/1 files/);
    assert.match(failed.stdout, /explicit-list-proof/);
    assert.doesNotMatch(failed.stdout, /real assertion/, "only the named file runs");
    const manifest = JSON.parse(readFileSync(join(root, ".scratch", "ci", "test-affected.json"), "utf8"));
    assert.equal(manifest.mode, "explicit");
    assert.equal(manifest.status, "failed");
    assert.deepEqual(manifest.selected, [affected]);
    assert.equal(manifest.timing.complete, true);
    assert.equal(manifest.timing.usableForScheduling, false);
    writeFileSync(join(root, affected), `import test from 'node:test'; import assert from 'node:assert/strict'; test('explicit-list-proof', () => assert.equal(2 + 2, 4));\n`);
    const passed = spawnSync(process.execPath, [RUNNER], { cwd: root, env, encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, ".scratch", "ci", "test-affected.json"), "utf8")).status, "passed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an explicit list outside the suite, repeated, empty, or set beside a shard is refused", () => {
  const suite = ["tests/a.test.ts", "tests/b.test.ts"];
  assert.deepEqual(parseTestFiles("tests/b.test.ts\r\ntests/a.test.ts", suite), suite);
  assert.throws(() => parseTestFiles("tests/missing.test.ts", suite), /outside the canonical suite/);
  assert.throws(() => parseTestFiles("tests/a.test.ts\ntests/a.test.ts", suite), /more than once/);
  assert.throws(() => parseTestFiles(" \n ", suite), /names no test files/);
  const root = fixture();
  try {
    const both = spawnSync(process.execPath, [RUNNER], { cwd: root,
      env: { ...runnerEnvironment(1), CI_TEST_FILES: "tests/a.test.ts" }, encoding: "utf8", timeout: 120_000, windowsHide: true });
    assert.equal(both.status, 1);
    assert.match(both.stderr, /not both/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
