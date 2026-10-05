/**
 * DB-53: new code loads without stopping the factory. A staged release whose
 * change leaves the parent runner's own code alone is loaded by starting new
 * children from its checkout, which shares the running checkout's host state.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { carryBackRuntimeState, linkRuntimeState, parentCodeChanged } from "../lib/ops/runtime-release-switch.ts";
import { defaultAsyncRunCommand, stagedReleaseDirectory } from "../lib/ops/runtime-release-stage.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function repo(): { root: string; commit: (files: Record<string, string>) => string } {
  const root = mkdtempSync(join(tmpdir(), "switch-"));
  git(root, "init", "-q");
  const commit = (files: Record<string, string>): string => {
    for (const [path, text] of Object.entries(files)) write(root, path, text);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "c");
    return git(root, "rev-parse", "HEAD");
  };
  return { root, commit };
}

const BASE = {
  "scripts/pilot-runner.mts": 'import { a } from "../lib/a.ts";\nconsole.log(a);\n',
  "lib/a.ts": 'export { b as a } from "./b.ts";\n',
  "lib/b.ts": "export const b = 1;\n",
  "lib/child-only.ts": "export const c = 1;\n",
  "scripts/freshness-shadow.mts": 'import { c } from "../lib/child-only.ts";\nconsole.log(c);\n',
  "package.json": "{}\n",
};

test("a release that changes only child code leaves the parent running", async () => {
  const { root, commit } = repo();
  const parent = commit(BASE);
  const target = commit({ "lib/child-only.ts": "export const c = 2;\n", "scripts/freshness-shadow.mts": "console.log(3);\n" });
  git(root, "checkout", "-q", "--detach", parent);
  const decision = await parentCodeChanged({ root, parentSha: parent, targetSha: target, run: defaultAsyncRunCommand });
  assert.deepEqual(decision, { changed: false, why: [] });
});

test("a release that changes a file the parent loads, or the packages, restarts the parent", async () => {
  const { root, commit } = repo();
  const parent = commit(BASE);
  const deep = commit({ "lib/b.ts": "export const b = 2;\n" });
  const packages = commit({ "package.json": '{"name":"x"}\n' });
  git(root, "checkout", "-q", "--detach", parent);
  assert.deepEqual(await parentCodeChanged({ root, parentSha: parent, targetSha: deep, run: defaultAsyncRunCommand }),
    { changed: true, why: ["lib/b.ts"] });
  const both = await parentCodeChanged({ root, parentSha: parent, targetSha: packages, run: defaultAsyncRunCommand });
  assert.equal(both.changed, true);
  assert.deepEqual([...both.why].sort(), ["lib/b.ts", "package.json"]);
});

test("a parent that loads code by a computed name cannot be proven unchanged", async () => {
  const { root, commit } = repo();
  const parent = commit({ ...BASE, "lib/a.ts": "export const a = await import(`./${process.env.X}.ts`);\n" });
  const target = commit({ "lib/child-only.ts": "export const c = 9;\n" });
  git(root, "checkout", "-q", "--detach", parent);
  const decision = await parentCodeChanged({ root, parentSha: parent, targetSha: target, run: defaultAsyncRunCommand });
  assert.equal(decision.changed, true);
  assert.match(decision.why[0]!, /computed name/);
});

test("the staged checkout shares the running checkout's host state and stays clean", async () => {
  const { root, commit } = repo();
  const sha = commit({ ...BASE, ".gitignore": "/node_modules\n/.runtime/\n/data/vault/\n*.log\n", "data/states/keep.txt": "tracked\n" });
  write(root, "data/vault/ab/cd.bin", "held bytes");
  write(root, ".runtime/ops/state.json", "{}");
  write(root, ".runtime/control-plane/x.json", "{}");
  write(root, "data/states/run.log", "log");
  write(root, "node_modules/pkg/index.js", "old");
  const directory = stagedReleaseDirectory(root, sha);
  git(root, "worktree", "add", "-q", "--detach", directory, sha);
  write(directory, "node_modules/pkg/index.js", "new");

  const linked = await linkRuntimeState({ root, directory, run: defaultAsyncRunCommand });
  assert.ok("linked" in linked, JSON.stringify(linked));
  assert.deepEqual([...linked.linked].sort(), [".runtime/control-plane", ".runtime/ops", "data/states/run.log", "data/vault"]);
  assert.equal(readlinkSync(join(directory, "data", "vault")), join(root, "data", "vault"));
  assert.equal(existsSync(join(directory, ".runtime", "releases")), false, "no link points back into the staged checkouts");
  assert.equal(readFileSync(join(directory, "node_modules", "pkg", "index.js"), "utf8"), "new", "each checkout keeps its own packages");
  // A child started from the new code writes into the running checkout's state.
  writeFileSync(join(directory, "data", "vault", "ab", "ef.bin"), "new bytes");
  assert.equal(readFileSync(join(root, "data", "vault", "ab", "ef.bin"), "utf8"), "new bytes");
  assert.equal(git(directory, "status", "--porcelain=v1", "--untracked-files=all"), "", "the staged checkout reads clean");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "", "the running checkout reads clean");

  // What a new child created only in the staged checkout is carried back before removal.
  write(directory, ".runtime/new-lane/state.json", "{\"new\":true}");
  write(directory, "data/states/new.log", "new log");
  const moved = await carryBackRuntimeState({ root, directory, run: defaultAsyncRunCommand });
  assert.deepEqual([...moved].sort(), [".runtime/new-lane", "data/states/new.log"]);
  assert.equal(readFileSync(join(root, ".runtime", "new-lane", "state.json"), "utf8"), "{\"new\":true}");
  assert.equal(lstatSync(join(root, "data", "vault")).isDirectory(), true, "links are never carried back over the real state");
  assert.equal(readFileSync(join(root, "node_modules", "pkg", "index.js"), "utf8"), "old");
});

test("the runner starts every child from the switched checkout, behind its switch, and keeps the drain path", () => {
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.doesNotMatch(runner, /\bcwd: ROOT\b/, "no child starts from the parent's checkout by name");
  assert.match(runner, /const RELEASE_QUICK_SWITCH = process\.env\.WTP_RELEASE_QUICK_SWITCH === "1";/);
  assert.match(runner, /if \(!RELEASE_QUICK_SWITCH \|\| PARENT_CODE_SHA === null\) return "DRAIN";/);
  assert.match(runner, /applyRuntimeContracts\(targetSha, directory\)/, "contract migrations run at the switch, from the new code");
  assert.match(runner, /researchCycleChild\.send\(\{ kind: "RUNTIME_RELEASE_DRAIN" \}/, "the drain path stays for a parent change");
});
