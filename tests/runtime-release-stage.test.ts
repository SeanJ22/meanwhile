import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readStagedRelease,
  stageRuntimeRelease,
  stagedReleaseDirectory,
  stagedReleaseIsReady,
  defaultAsyncRunCommand,
  type AsyncRunCommand,
} from "../lib/ops/runtime-release-stage.ts";

const TARGET = "3".repeat(40);

function fakeRun(options: { failOn?: string } = {}): { run: AsyncRunCommand; calls: string[] } {
  const calls: string[] = [];
  const run: AsyncRunCommand = async (executable, args, opts) => {
    const line = `${executable} ${args.join(" ")}`;
    calls.push(`${opts.cwd}::${line}`);
    if (options.failOn !== undefined && line.includes(options.failOn)) return { status: 1, stdout: "", stderr: "boom" };
    if (line.startsWith("git worktree add")) mkdirSync(args[3]!, { recursive: true });
    if (line.startsWith("git rev-parse")) return { status: 0, stdout: `${TARGET}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

test("a release installs in its own checkout, never in the running one", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const { run, calls } = fakeRun();
  const result = await stageRuntimeRelease({ root, targetSha: TARGET, run });
  const dir = stagedReleaseDirectory(root, TARGET);
  assert.equal(result.state, "READY");
  assert.equal(stagedReleaseIsReady(root, TARGET), true);
  const install = calls.find(call => call.includes("pnpm install --frozen-lockfile"));
  assert.ok(install?.startsWith(`${dir}::`), "the frozen install runs inside the staged checkout");
  assert.ok(!calls.some(call => call.startsWith(`${root}::`) && /switch|checkout|reset/.test(call)), "the running checkout is never switched");
});

test("a READY staging for the same target is reused without more commands", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const first = fakeRun();
  await stageRuntimeRelease({ root, targetSha: TARGET, run: first.run });
  const second = fakeRun();
  const again = await stageRuntimeRelease({ root, targetSha: TARGET, run: second.run });
  assert.equal(again.state, "READY");
  assert.equal(second.calls.length, 0);
});

test("a failed install is recorded, not ready, so the drain-first path can still land the release", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const { run } = fakeRun({ failOn: "pnpm install" });
  const result = await stageRuntimeRelease({ root, targetSha: TARGET, run });
  assert.equal(result.state, "FAILED");
  assert.equal(result.code, "FROZEN_INSTALL_FAILED");
  assert.equal(readStagedRelease(root)?.state, "FAILED");
  assert.equal(stagedReleaseIsReady(root, TARGET), false);
});

test("a commit not on main is refused before anything is checked out", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const { run, calls } = fakeRun({ failOn: "merge-base" });
  const result = await stageRuntimeRelease({ root, targetSha: TARGET, run });
  assert.equal(result.code, "DEPLOYED_COMMIT_NOT_ON_MAIN");
  assert.ok(!calls.some(call => call.includes("worktree add")));
  assert.equal(existsSync(stagedReleaseDirectory(root, TARGET)), false);
});

test("an invalid target is refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-"));
  const result = await stageRuntimeRelease({ root, targetSha: "nope", run: fakeRun().run });
  assert.equal(result.code, "TARGET_SHA_INVALID");
});

test("machine-readable command output stays complete beyond the old diagnostic tail limit", async () => {
  const result = await defaultAsyncRunCommand("printf", ["%s", "path\n".repeat(20000)], {
    cwd: process.cwd(), timeoutMs: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.length, 100_000);
  assert.equal(result.stdout.split("\n").length, 20_001);
});

test("a failed state carry leaves the older checkout and its evidence intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "stage-carry-"));
  const older = stagedReleaseDirectory(root, "2".repeat(40));
  mkdirSync(older, { recursive: true });
  writeFileSync(join(older, "evidence.txt"), "retained source bytes");
  const { run, calls } = fakeRun({ failOn: "ls-files" });
  const result = await stageRuntimeRelease({ root, targetSha: TARGET, run });
  assert.equal(result.state, "FAILED");
  assert.equal(result.code, "STAGED_STATE_CARRY_FAILED");
  assert.equal(readFileSync(join(older, "evidence.txt"), "utf8"), "retained source bytes");
  assert.ok(!calls.some(call => call.includes("worktree remove")));
});
