import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCheckedPullRequest } from "../scripts/ship-pr-checks.mjs";

const registered = JSON.stringify({ headRefOid: "tested-head", statusCheckRollup: [{ status: "IN_PROGRESS" }] });
test("shipping waits for checks and binds the merge to the tested head", async () => {
  const calls: { command: string; args: string[]; opts?: { timeout: number } }[] = [];
  const result = await mergeCheckedPullRequest({
    number: 266, head: "tested-head", run(command: string, args: string[], opts?: { timeout: number }) {
      calls.push({ command, args, opts });
      return args[1] === "view" ? registered : "";
    },
  });
  assert.equal(result, "merged");
  assert.deepEqual(calls, [
    { command: "gh", args: ["pr", "view", "266", "--json", "headRefOid,statusCheckRollup"], opts: undefined },
    { command: "gh", args: ["pr", "checks", "266", "--watch", "--fail-fast", "--interval", "20"], opts: { timeout: 1200000 } },
    { command: "gh", args: ["pr", "merge", "266", "--merge", "--match-head-commit", "tested-head"], opts: undefined },
  ]);
});

test("failed, unavailable or timed-out checks never reach the merge", async () => {
  let calls = 0;
  const result = await mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { calls++; return null; } });
  assert.equal(result, "checks-unavailable");
  assert.equal(calls, 1);
});

test("changed heads or protection refusals are not reported as merged", async () => {
  let calls = 0;
  const result = await mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { return ++calls === 1 ? registered : calls === 2 ? "green" : null; } });
  assert.equal(result, "merge-refused");
  assert.equal(calls, 3);
});

test("an empty check rollup waits for registration before starting the watch", async () => {
  let calls = 0;
  let clock = 0;
  const result = await mergeCheckedPullRequest({ number: 266, head: "tested-head", now: () => clock, sleep: async (ms: number) => { clock += ms; }, run(_command: string, args: string[]) {
    calls++;
    return args[1] === "view" ? calls === 1 ? JSON.stringify({ headRefOid: "tested-head", statusCheckRollup: [] }) : registered : "";
  } });
  assert.equal(result, "merged");
  assert.equal(clock, 20000);
  assert.equal(calls, 4);
});

test("checks that never register time out without a watch or merge", async () => {
  let clock = 0;
  const result = await mergeCheckedPullRequest({ number: 266, head: "tested-head", registrationTimeout: 20000, now: () => clock, sleep: async (ms: number) => { clock += ms; }, run(_command: string, args: string[]) {
    assert.equal(args[1], "view");
    return JSON.stringify({ headRefOid: "tested-head", statusCheckRollup: [] });
  } });
  assert.equal(result, "checks-not-registered");
  assert.equal(clock, 20000);
});

test("a different remote head is refused before waiting or merging", async () => {
  assert.equal(await mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { return JSON.stringify({ headRefOid: "different", statusCheckRollup: [] }); } }), "head-changed");
});

test("a failed check watch cannot reach merge", async () => {
  let calls = 0;
  assert.equal(await mergeCheckedPullRequest({ number: 266, head: "tested-head", run() { return ++calls === 1 ? registered : null; } }), "checks-not-green");
  assert.equal(calls, 2);
});
