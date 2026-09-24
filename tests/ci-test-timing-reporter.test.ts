import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import fileTimings, { normalizeFile, validateTimings } from "../scripts/ci-test-timing-reporter.mjs";

const ROOT = join(import.meta.dirname, "..");
const REPORTER = pathToFileURL(join(ROOT, "scripts", "ci-test-timing-reporter.mjs")).href;
const counts = { tests: 1, failed: 0, passed: 1, cancelled: 0, skipped: 0, todo: 0, topLevel: 1, suites: 0 };
const file = { schemaVersion: 1, kind: "file", file: "tests/a.test.ts", durationMs: 12, success: true, counts };
const run = { schemaVersion: 1, kind: "run", durationMs: 20, success: true, counts };
const end = { schemaVersion: 1, kind: "stream-end", fileSummaryCount: 1, runSummaryCount: 1 };
const text = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

test("timings use normalized file identity, not duplicate or nested display names", async () => {
  async function* events() {
    yield { type: "test:pass", data: { name: "same", duration_ms: 9000 } };
    yield { type: "test:summary", data: { file: join(process.cwd(), "tests", "a.test.ts"), duration_ms: 12, success: true, counts } };
    yield { type: "test:summary", data: { duration_ms: 20, success: true, counts } };
  }
  let output = "";
  for await (const chunk of fileTimings(events())) output += chunk;
  assert.deepEqual(output, text([file, run, end]));
  assert.equal(validateTimings(output, [file.file]).complete, true);
  // Deliberate Windows input follows the shared path guard's fixture idiom;
  // repository path literals themselves remain POSIX on every platform.
  const windowsInput = ["tests", "a.test.ts"].join(String.fromCharCode(92));
  assert.equal(normalizeFile(windowsInput), file.file);
  assert.equal(normalizeFile(pathToFileURL(join(process.cwd(), file.file)).href), file.file);
  assert.equal(normalizeFile("../outside.test.ts"), null);
});

test("timing gaps, duplicate files and malformed records remain explicit and unusable", () => {
  for (const rows of [[], [file, run], [file, end], [file, file, run, end], [file, run, end, end],
    [{ ...file, durationMs: -1 }, run, end], [{ ...file, durationMs: null }, run, end],
    [{ ...file, counts: {} }, run, end], [{ ...file, file: "../a.test.ts" }, run, end],
    [{ ...file, schemaVersion: 2 }, run, end], [file, run, { ...end, fileSummaryCount: 2 }]]) {
    const result = validateTimings(text(rows), [file.file]);
    assert.equal(result.complete, false, JSON.stringify(rows));
    assert.ok(result.issues.length > 0);
  }
  assert.equal(validateTimings(`${text([file, run, end])}{broken`, [file.file]).complete, false);
  assert.deepEqual(validateTimings(text([run, { ...end, fileSummaryCount: 0 }]), [file.file]).missingFiles, [file.file]);
  assert.equal(validateTimings(text([file, run, end]), [file.file, "tests/new.test.tsx"]).complete, false);
});

test("canonical TS/TSX loader retains spec failures and reports incomplete bootstrap, import and termination timings", () => {
  const home = join(ROOT, ".scratch", "ci");
  mkdirSync(home, { recursive: true });
  const root = mkdtempSync(join(home, "reporter-proof-"));
  try {
    mkdirSync(join(root, "tests"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "fixture-value.ts"), "export const value: number = 4;\n");
    const loader = join(root, "scripts", "register-test-loader.mjs");
    const register = `import ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "register-test-loader.mjs")).href)};\n`;
    const first = `import { test, after } from 'node:test'; import assert from 'node:assert/strict';
      import { value } from '@/fixture-value';
      const handle = setInterval(() => {}, 50);
      const emergency = setTimeout(() => clearInterval(handle), 1000);
      after(() => { clearInterval(handle); clearTimeout(emergency); });
      test('same', async (t) => { await t.test('same', () => assert.equal(value, 4)); });
      test('same', () => assert.ok(true));`;
    const second = `import test from 'node:test'; import assert from 'node:assert/strict';
      import { value } from '@/fixture-value';
      test('same', () => { const element = <span>{value}</span>; assert.equal(element.props.children, EXPECTED, 'retained assertion diagnostics'); });`;
    const expected = ["tests/a.test.ts", "tests/b.test.tsx"];
    for (const mode of ["pass", "assertion", "import", "bootstrap", "termination"] as const) {
      writeFileSync(loader, mode === "bootstrap" ? "throw new Error('bootstrap failure fixture');\n" : register);
      writeFileSync(join(root, expected[0]), first);
      writeFileSync(join(root, expected[1]), mode === "import" ? "import './missing-fixture-module.ts';\n"
        : mode === "termination" ? "process.kill(process.pid, 'SIGTERM');\n"
        : second.replace("EXPECTED", mode === "assertion" ? "5" : "4"));
      const destination = join(root, `${mode}.timings.jsonl`);
      writeFileSync(destination, "");
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--experimental-strip-types",
        "--import", "./scripts/register-test-loader.mjs", "--test-reporter=spec", "--test-reporter-destination=stdout",
        `--test-reporter=${REPORTER}`, `--test-reporter-destination=${destination}`, ...expected], {
        cwd: root, env, encoding: "utf8", timeout: 120_000, windowsHide: true,
      });
      assert.equal(result.error, undefined, `${mode} must terminate naturally with teardown handles closed`);
      const timing = validateTimings(readFileSync(destination, "utf8"), expected);
      if (mode === "pass" || mode === "assertion") {
        assert.equal(timing.complete, true, `${mode}: ${timing.issues.join(" ")}`);
        assert.deepEqual(timing.files.map((row) => row.file), expected);
        assert.match(result.stdout, /same/);
      } else {
        assert.equal(timing.complete, false, `${mode} must not manufacture a normal file measurement`);
        assert.ok(timing.missingFiles.includes(expected[1]));
      }
      if (mode === "pass") {
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.equal(timing.run?.success, true);
        assert.ok(timing.files.every((row) => row.success));
      } else {
        assert.notEqual(result.status, 0, `${mode} failure must remain a failed child`);
        if (mode === "assertion") {
          assert.match(result.stdout, /retained assertion diagnostics/);
          assert.equal(timing.run?.success, false);
          assert.equal(timing.files.find((row) => row.file === expected[1])?.success, false);
        }
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
