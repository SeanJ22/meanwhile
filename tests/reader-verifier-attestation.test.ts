import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  READER_VERIFIER_ENTRY,
  readerVerifierClosureAttestor,
} from "../scripts/lib/verifier-attestation.ts";

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function write(dir: string, path: string, content: string): void {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function commit(dir: string, message: string, files: Readonly<Record<string, string>>): string {
  for (const [path, content] of Object.entries(files)) write(dir, path, content);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

test("the attestor says identical only when every verifier closure file is the same bytes at both commits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-reader-attestor-"));
  try {
    git(dir, ["init", "--quiet"]);
    git(dir, ["config", "user.email", "r31@example.invalid"]);
    git(dir, ["config", "user.name", "reader attestor test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    git(dir, ["config", "core.autocrlf", "false"]);
    // The entry imports a helper statically and a typed Reader dynamically.
    const a = commit(dir, "base", {
      [READER_VERIFIER_ENTRY]: 'import { helper } from "./helper.ts";\nexport async function v() { const { read } = await import("../reader/typed.ts"); return helper(read()); }\n',
      "lib/civic-data/helper.ts": "export const helper = (x: unknown) => x;\n",
      "lib/reader/typed.ts": "export const read = () => 1;\n",
      "package.json": '{"name":"fixture"}\n',
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "docs/notes.md": "one\n",
    });
    const b = commit(dir, "docs only", { "docs/notes.md": "two\n" });

    const calls: string[] = [];
    const counted = readerVerifierClosureAttestor({
      root: dir,
      git: (args) => {
        calls.push(args[0]!);
        const run = spawnSync("git", [...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return { status: run.status, stdout: run.stdout ?? "" };
      },
    });
    const same = await counted(a, b);
    assert.equal(same.identical, true, same.detail);
    assert.match(same.detail, /all 5 files/);
    const gitCalls = calls.length;
    assert.equal((await counted(a, b)).identical, true);
    assert.equal(calls.length, gitCalls, "one answer per commit pair");

    // A dynamically imported typed Reader changed.
    const c = commit(dir, "typed reader", { "lib/reader/typed.ts": "export const read = () => 2;\n" });
    const changedReader = await readerVerifierClosureAttestor({ root: dir })(b, c);
    assert.equal(changedReader.identical, false);
    assert.match(changedReader.detail, /changed after/);

    // A dependency changed.
    const d = commit(dir, "lockfile", { "pnpm-lock.yaml": "lockfileVersion: 9.1\n" });
    assert.equal((await readerVerifierClosureAttestor({ root: dir })(c, d)).identical, false);

    // An unknown prior commit cannot be compared.
    const unknown = await readerVerifierClosureAttestor({ root: dir })("0".repeat(40), d);
    assert.equal(unknown.identical, false);
    assert.match(unknown.detail, /could not compare/);

    // The executing checkout must be the current commit's closure.
    const e = commit(dir, "docs again", { "docs/notes.md": "three\n" });
    write(dir, "lib/civic-data/helper.ts", "export const helper = (x: unknown) => [x];\n");
    const dirty = await readerVerifierClosureAttestor({ root: dir })(d, e);
    assert.equal(dirty.identical, false);
    assert.match(dirty.detail, /is not commit/);
    git(dir, ["checkout", "--quiet", "--", "lib/civic-data/helper.ts"]);
    assert.equal((await readerVerifierClosureAttestor({ root: dir })(d, e)).identical, true);

    // A closure file the current commit does not hold is never vouched for.
    const f = commit(dir, "import a file the commit does not hold", {
      [READER_VERIFIER_ENTRY]: 'import { helper } from "./helper.ts";\nimport "./local.ts";\nexport const v = helper;\n',
    });
    write(dir, "lib/civic-data/local.ts", "export {};\n");
    const untracked = await readerVerifierClosureAttestor({ root: dir })(e, f);
    assert.equal(untracked.identical, false);
    assert.match(untracked.detail, /not in commit/);

    // Malformed commits are refused before git runs.
    assert.equal((await readerVerifierClosureAttestor({ root: dir, git: () => { throw new Error("ran"); } })("HEAD", f)).identical, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a closure that cannot be walked is not identical, and the next ask walks again", async () => {
  let walks = 0;
  const attestor = readerVerifierClosureAttestor({
    root: ".",
    closure: async () => {
      walks += 1;
      if (walks === 1) throw new Error("Reader source disappeared");
      return ["lib/civic-data/reader-verification.ts"];
    },
    // Every git question answers "yes": the tree names every path asked about.
    git: (args) => ({ status: 0, stdout: args[0] === "ls-tree" ? `${args.slice(args.indexOf("--") + 1).join("\0")}\0` : "" }),
  });
  const first = await attestor("a".repeat(40), "b".repeat(40));
  assert.equal(first.identical, false);
  assert.match(first.detail, /could not be walked/);
  assert.equal((await attestor("a".repeat(40), "c".repeat(40))).identical, true);
  assert.equal(walks, 2);
});
