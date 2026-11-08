import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JobRunBook } from "../lib/control-plane/job-runs.ts";
import { applyRuntimeRelease } from "../lib/ops/runtime-release-handoff.ts";
import { defaultAsyncRunCommand, stageRuntimeRelease, type AsyncRunCommand } from "../lib/ops/runtime-release-stage.ts";
import {
  clearStaleGitLocks, failedRuntimeReleases, recordRunnerBeat, recordRuntimeSwitch, settleSwitch, takeRuntimeGuardNotes,
} from "../lib/ops/runtime-release-guard.ts";

/** Real git; the dependency link-up is a no-op because the fixture has no lockfile. */
const gitOnly: AsyncRunCommand = (executable, args, options) =>
  executable === "git" ? defaultAsyncRunCommand(executable, args, options) : Promise.resolve({ status: 0, stdout: "", stderr: "" });
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A runtime checkout cloned from a bare origin, detached at A, with B the newer deployed commit on main. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "wtp-guard-"));
  const origin = join(base, "origin.git"), root = join(base, "root");
  git(base, "init", "--bare", "-b", "main", origin);
  git(base, "clone", "-q", origin, root);
  git(root, "config", "user.email", "t@t"); git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".runtime/\n");
  writeFileSync(join(root, "f"), "a");
  git(root, "add", "."); git(root, "commit", "-qm", "a");
  const a = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "f"), "b"); git(root, "commit", "-qam", "b");
  const b = git(root, "rev-parse", "HEAD");
  git(root, "push", "-q", "origin", "main");
  git(root, "switch", "-q", "--detach", a);
  return { root, a, b };
}
const staleLock = (root: string, minutes: number, name = "index.lock") => {
  const path = join(root, ".git", name);
  writeFileSync(path, "");
  const at = new Date(Date.now() - minutes * 60_000);
  utimesSync(path, at, at);
  return path;
};

test("a stale index.lock with no git process is cleared and the switch succeeds", async () => {
  const { root, a, b } = fixture();
  const lock = staleLock(root, 9 * 60);
  const result = await applyRuntimeRelease({ root, targetSha: b, runCommand: gitOnly });
  assert.equal(result.state, "UPDATED", result.detail);
  assert.equal(existsSync(lock), false);
  assert.equal(git(root, "rev-parse", "HEAD"), b);
  assert.match(takeRuntimeGuardNotes(root)[0]?.text ?? "", /removed stale git lock \.git\/index\.lock \(540 min old/);
  assert.equal(a === b, false);
});

test("a switch after the release-install job stages it still clears a stale lock first and records the switch", async () => {
  const { root, a, b } = fixture();
  const lock = staleLock(root, 9 * 60);
  const staged = await stageRuntimeRelease({ root, targetSha: b, run: gitOnly });
  assert.equal(staged.state, "READY", staged.detail);
  assert.equal(existsSync(lock), false, "the staging's own git steps cleared the stale lock");
  const lock2 = staleLock(root, 9 * 60, "HEAD.lock");
  const result = await applyRuntimeRelease({ root, targetSha: b, runCommand: gitOnly });
  assert.equal(result.state, "UPDATED", result.detail);
  assert.equal(existsSync(lock2), false);
  const record = JSON.parse(readFileSync(join(root, ".runtime", "ops", "runtime-release-guard.json"), "utf8")).switch;
  assert.equal(record.previousSha, a);
  assert.equal(record.targetSha, b);
});

test("a young lock, and a lock while a live git process works in the checkout, are never touched", { skip: process.platform !== "linux" }, async () => {
  const { root } = fixture();
  const young = staleLock(root, 1);
  assert.deepEqual(clearStaleGitLocks(root), []);
  assert.equal(existsSync(young), true);
  const lock = staleLock(root, 30, "HEAD.lock");
  const live = spawn("git", ["hash-object", "--stdin"], { cwd: root, stdio: ["pipe", "ignore", "ignore"] });
  await new Promise(resolve => setTimeout(resolve, 300));
  try {
    assert.deepEqual(clearStaleGitLocks(root), []);
    assert.equal(existsSync(lock), true);
  } finally {
    live.stdin!.end();
    await new Promise(resolve => live.once("exit", resolve));
  }
  assert.equal(clearStaleGitLocks(root).length, 1);
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(young), true);
});

test("a switched runner that never beats within 5 minutes goes back, is marked failed, and is not retried", () => {
  const { root, a, b } = fixture();
  const t0 = Date.parse("2026-11-07T09:00:00Z");
  git(root, "switch", "-q", "--detach", b);
  recordRuntimeSwitch(root, a, b, t0);
  assert.equal(settleSwitch(root, t0 + 4 * 60_000).state, "pending");
  assert.equal(git(root, "rev-parse", "HEAD"), b);
  assert.equal(settleSwitch(root, t0 + 5 * 60_000 + 1).state, "rolledBack");
  assert.equal(git(root, "rev-parse", "HEAD"), a);
  assert.deepEqual(failedRuntimeReleases(root), [b]);
  const hold = JSON.parse(readFileSync(join(root, ".runtime/ops/runtime-release-hold.json"), "utf8"));
  assert.deepEqual([hold.targetSha, hold.switched], [a, true]);
  assert.match(takeRuntimeGuardNotes(root)[0]?.text ?? "", /no heartbeat within 5 minutes.*back on/);
  assert.equal(settleSwitch(root, t0 + 20 * 60_000).state, "none");
  assert.equal(git(root, "rev-parse", "HEAD"), a);
});

test("a switched runner that beats in time stays", () => {
  const { root, a, b } = fixture();
  const t0 = Date.parse("2026-11-07T09:00:00Z");
  git(root, "switch", "-q", "--detach", b);
  recordRuntimeSwitch(root, a, b, t0);
  recordRunnerBeat(root, a, t0 + 30_000); // the old copy's beat does not count
  recordRunnerBeat(root, b, t0 + 90_000);
  assert.equal(settleSwitch(root, t0 + 10 * 60_000).state, "healthy");
  assert.equal(git(root, "rev-parse", "HEAD"), b);
  assert.deepEqual(failedRuntimeReleases(root), []);
  assert.equal(settleSwitch(root, t0 + 20 * 60_000).state, "none");
});

test("the launcher, started in a crash loop with a stale lock and an overdue switch, clears the lock and restores the previous copy", () => {
  const { root, a, b } = fixture();
  git(root, "switch", "-q", "--detach", b);
  recordRuntimeSwitch(root, a, b, Date.now() - 6 * 60_000);
  const lock = staleLock(root, 9 * 60);
  const launched = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/pilot-runtime-launch.mjs"], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, WTP_RUNTIME_REPO: root },
  });
  assert.equal(launched.status, 1, launched.stderr);
  assert.equal(existsSync(lock), false);
  assert.equal(git(root, "rev-parse", "HEAD"), a);
  assert.match(launched.stderr, /removed stale git lock/);
  assert.match(launched.stderr, /back on/);
});

test("a launcher pass with no notes is still a finished run, and the next pass records again", () => {
  let clock = Date.parse("2026-11-07T10:00:00Z");
  const book = new JobRunBook(() => new Date(clock).toISOString());
  book.register("runtime-release-guard", 86_400_000);
  book.settled("runtime-release-guard", []);
  const first = book.merged(null)["runtime-release-guard"]!;
  assert.deepEqual([first.lastStartedAt, first.lastFinishedAt, first.lastFailedAt], ["2026-11-07T10:00:00.000Z", "2026-11-07T10:00:00.000Z", null]);
  clock += 86_400_000;
  book.settled("runtime-release-guard", ["removed stale git lock"]);
  const next = book.merged(null)["runtime-release-guard"]!;
  assert.deepEqual([next.lastFinishedAt, next.lastError], ["2026-11-08T10:00:00.000Z", "removed stale git lock"]);
});
