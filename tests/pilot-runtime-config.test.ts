import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolvePilotMirror, validateRuntimeConfig } from "../scripts/pilot-runtime-config.mjs";

test("staging has no shared mirror and accepts only a mirror inside its worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-staging-mirror-"));
  const root = join(dir, "worktree");
  mkdirSync(root);
  try {
    assert.equal(resolvePilotMirror(root, undefined, true), null);
    assert.equal(resolvePilotMirror(root, join(dir, "shared"), true), null);
    assert.equal(resolvePilotMirror(root, join(dir, "worktree-other"), true), null);
    assert.equal(resolvePilotMirror(root, join(root, "mirror"), true), join(root, "mirror"));
    const shared = join(dir, "shared");
    mkdirSync(shared);
    symlinkSync(shared, join(root, "linked-mirror"), "junction");
    assert.equal(resolvePilotMirror(root, join(root, "linked-mirror", "new-digest-directory"), true), null);
    assert.equal(resolvePilotMirror(root, undefined, false), "G:/My Drive/we-the-people");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

interface Fixture {
  readonly dir: string;
  readonly repo: string;
  readonly envFile: string;
  readonly sha: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(options: { readonly trackedEnv?: boolean } = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "wtp-pilot-runtime-"));
  const repo = join(dir, "runtime");
  const envFile = options.trackedEnv ? join(repo, ".env.local") : join(dir, "runtime.env");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts", "pilot-runner.mts"), "// runner\n");
  writeFileSync(
    join(repo, "scripts", "pilot-runtime-config.mjs"),
    readFileSync(join(process.cwd(), "scripts", "pilot-runtime-config.mjs")),
  );
  writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(envFile, "SECRET_VALUE=never-read-by-validator\n");
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "runtime-test@example.invalid");
  git(repo, "config", "user.name", "Runtime Test");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "runtime release");
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/main", sha);
  git(repo, "switch", "--detach", "-q", sha);
  return { dir, repo, envFile, sha };
}

function withFixture(
  options: { readonly trackedEnv?: boolean },
  run: (value: Fixture) => void,
): void {
  const value = fixture(options);
  try {
    run(value);
  } finally {
    rmSync(value.dir, { recursive: true, force: true });
  }
}

test("standing runtime accepts only a clean detached checkout at the explicit deployed SHA", () => {
  withFixture({}, ({ repo, envFile, sha }) => {
    const result = validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: sha });
    assert.equal(result.repoPath, repo);
    assert.equal(result.envFile, envFile);
    assert.equal(result.expectedSha, sha);
  });
});

test("standing runtime refuses dirty, branch-attached, or off-SHA checkouts", () => {
  withFixture({}, ({ repo, envFile, sha }) => {
    writeFileSync(join(repo, "untracked-runtime-authority.json"), "{}\n");
    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: sha }),
      /runtime checkout is not clean/,
    );
    rmSync(join(repo, "untracked-runtime-authority.json"));

    git(repo, "switch", "-q", "-c", "runtime-branch");
    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: sha }),
      /must be detached/,
    );
    git(repo, "switch", "--detach", "-q", sha);

    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: "f".repeat(40) }),
      /does not equal expected deployed SHA/,
    );
  });
});

test("standing runtime requires an absolute environment path and refuses a tracked secret file", () => {
  withFixture({}, ({ repo, sha }) => {
    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile: ".env.local", expectedSha: sha }),
      /environment file must be absolute/,
    );
  });
  withFixture({ trackedEnv: true }, ({ repo, envFile, sha }) => {
    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: sha }),
      /environment file is tracked by Git/,
    );
  });
});

test("standing runtime refuses a SHA that is not proven on origin/main", () => {
  withFixture({}, ({ repo, envFile, sha }) => {
    git(repo, "update-ref", "-d", "refs/remotes/origin/main");
    assert.throws(
      () => validateRuntimeConfig({ repoPath: repo, envFile, expectedSha: sha }),
      /not proven present on origin\/main/,
    );
  });
});

test("the Windows installer executes only the target commit's exact validator bytes", {
  skip: process.platform !== "win32",
}, () => {
  withFixture({}, ({ repo, envFile, sha }) => {
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(process.cwd(), "scripts", "pilot-task.ps1"),
      "-Action",
      "validate-config",
      "-RepoPath",
      repo,
      "-EnvFile",
      envFile,
      "-ExpectedDeployedSha",
      sha,
    ];
    const accepted = spawnSync("powershell.exe", args, { encoding: "utf8", windowsHide: true });
    assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
    assert.match(accepted.stdout, /RUNTIME CONFIG VALID/);

    writeFileSync(join(repo, "scripts", "pilot-runtime-config.mjs"), "process.stdout.write('{\\\"forged\\\":true}\\n');\n");
    const refused = spawnSync("powershell.exe", args, { encoding: "utf8", windowsHide: true });
    assert.notEqual(refused.status, 0);
    assert.match(
      `${refused.stdout}\n${refused.stderr}`,
      /validator does not equal the expected deployed commit's validator/,
    );
  });
});
