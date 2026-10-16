import assert from "node:assert/strict";
import test from "node:test";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headSha } from "../lib/ops/git-facts.ts";

test("HEAD identity follows loose refs, packed refs, detached worktrees and repository changes", t => {
  const root = mkdtempSync(join(tmpdir(), "git-facts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo # %"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-m", "First"); const first = git("rev-parse", "HEAD");
  assert.equal(headSha(repo), first); assert.equal(headSha(repo), first);
  git("commit", "--allow-empty", "-m", "Second"); const second = git("rev-parse", "HEAD");
  assert.equal(headSha(repo), second);
  git("pack-refs", "--all", "--prune"); assert.equal(headSha(repo), second);
  git("update-ref", "refs/heads/main", first); assert.equal(headSha(repo), first);
  git("pack-refs", "--all", "--prune"); assert.equal(headSha(repo), first);
  git("checkout", "--detach", second); assert.equal(headSha(repo), second);
  const worktree = join(root, "worktree"); git("worktree", "add", "--detach", worktree, first);
  assert.equal(headSha(worktree), first); assert.equal(headSha(worktree), first);
  execFileSync("git", ["checkout", "--detach", second], { cwd: worktree, stdio: "ignore" });
  assert.equal(headSha(worktree), second); assert.equal(headSha(repo), second);
});

test("HEAD identity follows reftable updates", t => {
  const repo = mkdtempSync(join(tmpdir(), "git-facts-reftable-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const initialized = spawnSync("git", ["init", "--ref-format=reftable", "-b", "main"], { cwd: repo });
  if (initialized.status !== 0) { t.skip("Installed Git does not support reftable repositories."); return; }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-m", "First"); const first = git("rev-parse", "HEAD");
  assert.equal(headSha(repo), first); assert.equal(headSha(repo), first);
  git("commit", "--allow-empty", "-m", "Second"); const second = git("rev-parse", "HEAD");
  assert.notEqual(first, second); assert.equal(headSha(repo), second);
});

test("unchanged HEAD identity reuses verified metadata without another Git process", t => {
  const repo = mkdtempSync(join(tmpdir(), "git-facts-cache-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-m", "First"); const first = git("rev-parse", "HEAD");
  assert.equal(headSha(repo), first);
  const commands = t.mock.method(childProcess, "execFileSync", () => { throw new Error("Unexpected Git invocation"); });
  syncBuiltinESMExports();
  t.after(() => { commands.mock.restore(); syncBuiltinESMExports(); });
  for (let call = 0; call < 100; call++) assert.equal(headSha(repo), first);
  assert.equal(commands.mock.callCount(), 0);
});

test("HEAD identity follows intermediate symbolic refs and worktree-private refs", t => {
  const root = mkdtempSync(join(tmpdir(), "git-facts-symbolic-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("commit", "--allow-empty", "-m", "First"); const first = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-m", "Second"); const second = git("rev-parse", "HEAD");
  git("update-ref", "refs/heads/first", first); git("update-ref", "refs/heads/second", second);
  git("symbolic-ref", "refs/heads/alias", "refs/heads/first"); git("symbolic-ref", "HEAD", "refs/heads/alias");
  assert.equal(headSha(repo), first); assert.equal(headSha(repo), first);
  git("symbolic-ref", "refs/heads/alias", "refs/heads/second");
  assert.equal(headSha(repo), second);
  git("update-ref", "refs/heads/second", first); assert.equal(headSha(repo), first);
  const worktree = join(root, "worktree"); git("worktree", "add", "--detach", worktree, first);
  const worktreeGit = (...args: string[]) => execFileSync("git", args, { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  worktreeGit("update-ref", "refs/worktree/private", first);
  worktreeGit("symbolic-ref", "HEAD", "refs/worktree/private");
  assert.equal(headSha(worktree), first); assert.equal(headSha(worktree), first);
  worktreeGit("update-ref", "refs/worktree/private", second);
  assert.equal(headSha(worktree), second);
});
