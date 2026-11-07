import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyRuntimeRelease } from "../lib/ops/runtime-release-handoff.ts";
import {
  clearStaleGitLocks, failedRuntimeReleases, recordRunnerBeat, recordRuntimeSwitch, settleSwitch, takeRuntimeGuardNotes,
} from "../lib/ops/runtime-release-guard.ts";

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

test("a stale index.lock with no git process is cleared and the switch succeeds", () => {
  const { root, a, b } = fixture();
  const lock = staleLock(root, 9 * 60);
  const result = applyRuntimeRelease({ root, targetSha: b, install: false });
  assert.equal(result.state, "UPDATED", result.detail);
  assert.equal(existsSync(lock), false);
  assert.equal(git(root, "rev-parse", "HEAD"), b);
  assert.match(takeRuntimeGuardNotes(root)[0]?.text ?? "", /removed stale git lock \.git\/index\.lock \(540 min old/);
  assert.equal(a === b, false);
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
