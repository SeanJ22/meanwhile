import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCheckedPullRequest } from "../scripts/ship-pr-checks.mjs";

test("shipping waits for checks and binds the merge to the tested head", () => {
  const calls: { command: string; args: string[]; opts?: { timeout: number } }[] = [];
  const result = mergeCheckedPullRequest({
    number: 266, head: "tested-head", run(command: string, args: string[], opts?: { timeout: number }) {
      calls.push({ command, args, opts });
      return "";
    },
  });
  assert.equal(result, "merged");
  assert.deepEqual(calls, [
    { command: "gh", args: ["pr", "checks", "266", "--watch", "--fail-fast", "--interval", "20"], opts: { timeout: 1200000 } },
    { command: "gh", args: ["pr", "merge", "266", "--merge", "--match-head-commit", "tested-head"], opts: undefined },
  ]);
});

test("failed, unavailable or timed-out checks never reach the merge", () => {
  let calls = 0;
  const result = mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { calls++; return null; } });
  assert.equal(result, "checks-not-green");
  assert.equal(calls, 1);
});

test("changed heads or protection refusals are not reported as merged", () => {
  let calls = 0;
  const result = mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { return ++calls === 1 ? "green" : null; } });
  assert.equal(result, "merge-refused");
  assert.equal(calls, 2);
});
