import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluate } from "../scripts/ci-verdict.mjs";

function needs(tier = "yes", result = "success") {
  return {
    admission: { result: "success", outputs: { tier } },
    verify: { result },
    test: { result },
    build: { result },
  };
}

test("full certification requires successful verification, tests and both aggregated build legs", () => {
  const verdict = evaluate(needs());
  assert.equal(verdict.ok, true);
  assert.ok(verdict.checks.every((check) => check.required && check.accepted));

  for (const job of ["verify", "test", "build"] as const) {
    for (const result of ["failure", "cancelled", "skipped", "", "neutral", "timed_out"]) {
      const input = needs();
      input[job].result = result;
      const failed = evaluate(input);
      assert.equal(failed.ok, false, `${job}=${result} must block full certification`);
      assert.ok(failed.reasons.some((reason) => reason.startsWith(`${job}:`)));
    }
  }
});

test("an affected failing test remains selected and blocks the full PR verdict", () => {
  const input = needs();
  input.test.result = "failure";
  const verdict = evaluate(input);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ["test: failure; required for this admission."]);
  assert.equal(verdict.checks.find((check) => check.job === "test")?.required, true);
});

test("a missing job or result fails even when its work is deliberately unneeded", () => {
  for (const tier of ["yes", "draft", "main"]) {
    for (const job of ["admission", "verify", "test", "build"] as const) {
      const input: Record<string, unknown> = needs(tier);
      delete input[job];
      assert.equal(evaluate(input).ok, false, `${tier}: absent ${job}`);
      input[job] = {};
      assert.equal(evaluate(input).ok, false, `${tier}: absent ${job}.result`);
    }
  }
});

test("draft explicitly defers tests and builds while requiring structural verification", () => {
  const input = needs("draft");
  input.test.result = "skipped";
  input.build.result = "skipped";
  const verdict = evaluate(input);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.filter((check) => !check.required).map((check) => check.job), ["test", "build"]);
  input.verify.result = "skipped";
  assert.equal(evaluate(input).ok, false);
});

test("a push to main needs only the build; the merged pull request already ran verify and the tests", () => {
  const input = needs("main");
  input.test.result = "skipped";
  input.verify.result = "skipped";
  const verdict = evaluate(input);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.checks.filter((check) => !check.required).map((check) => check.job), ["verify", "test"]);
  input.build.result = "skipped";
  assert.equal(evaluate(input).ok, false);
});

test("a ready PR without auto-merge never certifies: its verdict stays red until the full run", () => {
  const input = needs("waiting");
  input.test.result = "skipped";
  input.build.result = "success";
  const verdict = evaluate(input);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((reason) => reason.startsWith("waiting:")));
});

test("unneeded work that failed or was cancelled is never described as a safe omission", () => {
  for (const tier of ["draft", "main"]) {
    for (const job of ["verify", "test", "build"] as const) {
      for (const result of ["failure", "cancelled"]) {
        const input = needs(tier);
        input[job].result = result;
        assert.equal(evaluate(input).ok, false, `${tier}: ${job}=${result}`);
      }
    }
  }
});

test("malformed input and missing or unexpected tier fail closed even with otherwise green jobs", () => {
  for (const value of [null, undefined, [], "success", 1, {}, { admission: { result: "success" } }]) {
    assert.equal(evaluate(value).ok, false);
  }
  for (const tier of ["", "full", "no-preflight", "no-cheap", "YES", "no-certified "]) {
    assert.equal(evaluate(needs(tier)).ok, false, tier);
  }
});

const script = fileURLToPath(new URL("../scripts/ci-verdict.mjs", import.meta.url));
function cli(value: string) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, CI_NEEDS: value },
  });
}

test("CLI fails with an explicit cause for invalid JSON and a selected failing test", () => {
  const invalid = cli("{");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid JSON/);
  const input = needs();
  input.test.result = "failure";
  const failed = cli(JSON.stringify(input));
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /CI verdict: FAIL/);
  assert.match(failed.stderr, /test: failure; required/);
  assert.equal(cli(JSON.stringify(needs())).status, 0);
});

test("import is side-effect free and does not execute the CLI", () => {
  const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../scripts/ci-verdict.mjs", import.meta.url).href)})`], {
    encoding: "utf8",
    env: { ...process.env, CI_NEEDS: "invalid" },
  });
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});
