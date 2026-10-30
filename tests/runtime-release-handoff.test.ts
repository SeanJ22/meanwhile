import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RUNTIME_RELEASE_HOLD_RELATIVE_PATH,
  applyRuntimeRelease,
  resumeRuntimeReleaseInstall,
  writeRuntimeReleaseHold,
  fetchGithubCheckRuns,
  fetchRuntimeProductionDeploys,
  githubRepositoryFromOrigin,
  inspectRuntimeReleaseEvidence,
  inspectNewestDeployedRuntimeRelease,
  requiredContextEvidence,
  runtimeGithubCredential,
  runtimeProductionReadEnvironment,
  runtimePackageManagerCommand,
  type CommandResult,
  type GithubCheckRun,
  type RuntimeProductionDeploy,
} from "../lib/ops/runtime-release-handoff.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-contexts.ts";

const RUNNING = "1".repeat(40);
const TARGET = "2".repeat(40);

test("Windows frozen install invokes same-Node Corepack JavaScript with unparsed argument paths", () => {
  const node = "C:\\Program Files\\Node & Tools\\node.exe";
  const entry = "C:\\Program Files\\Node & Tools\\node_modules\\corepack\\dist\\corepack.js";
  const command = runtimePackageManagerCommand({ platform: "win32", nodeExecutable: node, exists: path => path === entry });
  assert.deepEqual(command, { executable: node, args: [entry, "pnpm", "install", "--frozen-lockfile"] });
  assert.equal(command?.executable.endsWith(".cmd"), false);
  assert.equal(runtimePackageManagerCommand({ platform: "win32", nodeExecutable: node, exists: () => false }), null);
});

test("non-Windows handoff retains direct Corepack execution", () => {
  assert.deepEqual(runtimePackageManagerCommand({ platform: "linux", nodeExecutable: "/usr/bin/node", exists: () => false }),
    { executable: "corepack", args: ["pnpm", "install", "--frozen-lockfile"] });
});

test("operational civic reads bind the explicit production read handle without rewriting credentials", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_URL: "postgresql://developer:fixture@dev.example/test", WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@production.example/live", WTP_PRODUCTION_DATABASE_URL_WRITE: "postgresql://writer:fixture@production.example/live", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://control:fixture@control.example/control" };
  const before = { ...env };
  const child = runtimeProductionReadEnvironment(env);
  assert.equal(child.DATABASE_URL, env.WTP_PRODUCTION_DATABASE_URL_READONLY);
  assert.equal(child.WTP_PRODUCTION_DATABASE_URL_WRITE, env.WTP_PRODUCTION_DATABASE_URL_WRITE);
  assert.equal(child.WTP_CONTROL_PLANE_DATABASE_URL, env.WTP_CONTROL_PLANE_DATABASE_URL);
  assert.deepEqual(env, before);
  for (const value of [undefined, "", "  ", "malformed-sensitive-value", "https://example.test"])
    assert.throws(() => runtimeProductionReadEnvironment({ NODE_ENV: "test", DATABASE_URL: env.DATABASE_URL, WTP_PRODUCTION_DATABASE_URL_READONLY: value }), /RUNTIME_CIVIC_READ_TARGET_(?:UNAVAILABLE|INVALID)$/);
});

test("standing runtime resolves saved GitHub credentials in order", () => {
  assert.equal(runtimeGithubCredential({ GH_TOKEN: "configured", GITHUB_TOKEN: "other" }), "configured");
  assert.equal(runtimeGithubCredential({ GITHUB_TOKEN: "other" }), "other");
});

test("missing saved credentials preserve the release refusal", () => {
  assert.equal(runtimeGithubCredential({}), null);
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(runner, /token: runtimeGithubCredential\(storedKeyEnvironment\(\)\)/);
  assert.equal(inspectRuntimeReleaseEvidence({ runningSha: TARGET, served: { sha: TARGET, how: "fixture", httpStatus: 200 }, checkRuns: null }).code, "SOFTWARE_CI_UNREADABLE");
});

function checks(conclusion: string | null = "success"): GithubCheckRun[] {
  return REQUIRED_CONTEXTS.map((name, index) => ({
    name,
    conclusion,
    completed_at: `2026-09-09T00:00:0${index}Z`,
    id: index,
  }));
}

test("the exact served, CI-passing SHA is current or requires one handoff", () => {
  const update = inspectRuntimeReleaseEvidence({
    runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    checkRuns: checks(),
  });
  assert.equal(update.state, "UPDATE_REQUIRED");
  assert.equal(update.targetSha, TARGET);
  assert.deepEqual(update.reliedOn, REQUIRED_CONTEXTS);

  const current = inspectRuntimeReleaseEvidence({
    runningSha: TARGET,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    checkRuns: checks(),
  });
  assert.equal(current.state, "CURRENT");
});

const deploy = (sha: string, day: number): RuntimeProductionDeploy => ({
  commit_ref: sha, context: "production", branch: "main", state: "ready",
  published_at: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`,
});

test("green served code avoids deployment-history reads", async () => {
  const result = await inspectNewestDeployedRuntimeRelease({ runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture", httpStatus: 200 }, checkRuns: checks(),
    readDeploys: async () => { throw new Error("history was unnecessary"); },
    readChecks: async () => { throw new Error("CI was already read"); },
  });
  assert.equal(result.targetSha, TARGET);
});

test("pending deployed head retains or adopts the newest published green code", async () => {
  const middle = "3".repeat(40);
  for (const runningSha of [RUNNING, "4".repeat(40)]) {
    const read: string[] = [];
    const result = await inspectNewestDeployedRuntimeRelease({ runningSha,
      served: { sha: TARGET, how: "fixture", httpStatus: 200 }, checkRuns: checks(null),
      readDeploys: async () => [deploy(RUNNING, 1), deploy(TARGET, 3), deploy(middle, 2), deploy(RUNNING, 1)],
      readChecks: async sha => { read.push(sha); return sha === RUNNING ? checks() : checks("failure"); },
    });
    assert.equal(result.targetSha, RUNNING);
    assert.equal(result.state, runningSha === RUNNING ? "CURRENT" : "UPDATE_REQUIRED");
    assert.deepEqual(result.reliedOn, REQUIRED_CONTEXTS);
    assert.deepEqual(read, [middle, RUNNING]);
  }
});

test("history never admits previews, unpublished builds, non-main code or code beyond a rollback", async () => {
  const excluded = "3".repeat(40);
  const read: string[] = [];
  const result = await inspectNewestDeployedRuntimeRelease({ runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture", httpStatus: 200 }, checkRuns: checks(null),
    readDeploys: async () => [deploy(excluded, 5), deploy(TARGET, 4),
      { ...deploy(excluded, 3), context: "deploy-preview" },
      { ...deploy(excluded, 3), published_at: null },
      { ...deploy(excluded, 3), branch: "test" },
      { ...deploy(excluded, 3), state: "error" }, deploy(RUNNING, 1)],
    readChecks: async sha => { read.push(sha); return checks(); },
  });
  assert.equal(result.targetSha, RUNNING);
  assert.deepEqual(read, [RUNNING]);
});

test("unreadable or unanchored history and no green published candidate preserve the existing hold", async () => {
  for (const history of [null, [deploy(RUNNING, 1)], [deploy(TARGET, 2), deploy(RUNNING, 1)]]) {
    const result = await inspectNewestDeployedRuntimeRelease({ runningSha: RUNNING,
      served: { sha: TARGET, how: "fixture", httpStatus: 200 }, checkRuns: checks(null),
      readDeploys: async () => history, readChecks: async () => checks("failure"),
    });
    assert.equal(result.state, "REFUSED");
    assert.equal(result.targetSha, TARGET);
    assert.equal(result.code, "REQUIRED_CONTEXT_NOT_GREEN");
  }
});

test("production deploy reader uses the configured project and keeps API failures unreadable", async () => {
  let url = "";
  let authorization = "";
  const rows = await fetchRuntimeProductionDeploys({ siteId: "fixture-site", token: "fixture-secret",
    fetchImpl: async (input, init) => { url = String(input); authorization = String((init?.headers as Record<string, string>).authorization);
      return new Response(JSON.stringify([deploy(TARGET, 1)])); },
  });
  assert.equal(url, "https://api.netlify.com/api/v1/sites/fixture-site/deploys?per_page=40");
  assert.equal(authorization, "Bearer fixture-secret");
  assert.equal(rows?.length, 1);
  assert.equal(await fetchRuntimeProductionDeploys({ siteId: "fixture-site", token: undefined }), null);
  assert.equal(await fetchRuntimeProductionDeploys({ siteId: "fixture-site", token: "fixture-secret",
    fetchImpl: async () => new Response("private error", { status: 403 }) }), null);
});

test("handoff fails closed on short/unknown served SHA, unreadable or failed CI", () => {
  const base = {
    runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    checkRuns: checks(),
  };
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, served: { ...base.served, sha: TARGET.slice(0, 7) } }).code, "DEPLOYED_SHA_UNRESOLVED");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, checkRuns: null }).code, "SOFTWARE_CI_UNREADABLE");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, checkRuns: checks("failure") }).code, "REQUIRED_CONTEXT_NOT_GREEN");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, checkRuns: checks(null) }).code, "REQUIRED_CONTEXT_NOT_GREEN");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, checkRuns: checks().slice(1) }).code, "REQUIRED_CONTEXT_MISSING");
});

test("newest exact required-context attempt governs; no non-success conclusion is treated as green", () => {
  const name = REQUIRED_CONTEXTS[0];
  const evidence = requiredContextEvidence([
    ...checks(),
    { name, conclusion: "failure", completed_at: "2026-09-09T00:01:00Z", id: 100 },
    { name, conclusion: "success", completed_at: "2026-09-09T00:02:00Z", id: 101 },
  ]);
  assert.equal(evidence.ok, true);
  const reversed = requiredContextEvidence([
    ...checks(),
    { name, conclusion: "success", completed_at: "2026-09-09T00:01:00Z", id: 100 },
    { name, conclusion: "cancelled", completed_at: "2026-09-09T00:02:00Z", id: 101 },
  ]);
  assert.equal(reversed.ok, false);

  const oldSlowSuccess = requiredContextEvidence([
    ...checks(),
    {
      name,
      conclusion: "success",
      started_at: "2026-09-09T00:01:00Z",
      completed_at: "2026-09-09T00:10:00Z",
      id: 200,
    },
    {
      name,
      conclusion: "failure",
      started_at: "2026-09-09T00:02:00Z",
      completed_at: "2026-09-09T00:03:00Z",
      id: 201,
    },
  ]);
  assert.equal(oldSlowSuccess.ok, false, "an older slow success hid the newer failed attempt");
});

test("origin parsing supports the repository's HTTPS and SSH forms without retaining .git", () => {
  assert.equal(githubRepositoryFromOrigin("https://github.com/SeanJ22/meanwhile.git"), "SeanJ22/meanwhile");
  assert.equal(githubRepositoryFromOrigin("git@github.com:SeanJ22/meanwhile.git"), "SeanJ22/meanwhile");
  assert.equal(githubRepositoryFromOrigin("https://example.com/SeanJ22/meanwhile.git"), null);
});

test("GitHub check reader refuses truncation and does not expose its token", async () => {
  let authorization = "";
  const fetchImpl: typeof fetch = async (_input, init) => {
    authorization = String((init?.headers as Record<string, string>).authorization ?? "");
    return new Response(JSON.stringify({ total_count: checks().length, check_runs: checks() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const rows = await fetchGithubCheckRuns({ repository: "SeanJ22/meanwhile", sha: TARGET, token: "fixture-secret", fetchImpl });
  assert.equal(rows?.length, REQUIRED_CONTEXTS.length);
  assert.equal(authorization, "Bearer fixture-secret");

  const truncated = await fetchGithubCheckRuns({
    repository: "SeanJ22/meanwhile",
    sha: TARGET,
    fetchImpl: async () => new Response(JSON.stringify({ total_count: 101, check_runs: checks() }), { status: 200 }),
  });
  assert.equal(truncated, null);
});

test("quiescent apply fetches only origin/main, detaches exact target, frozen-installs, and verifies clean readback", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-runtime-release-success-"));
  const calls: string[] = [];
  let statusReads = 0;
  const run = (executable: string, args: readonly string[], options: { readonly env?: NodeJS.ProcessEnv }): CommandResult => {
    calls.push(`${executable} ${args.join(" ")}`);
    if (args.includes("install")) {
      assert.equal(options.env?.CI, "true");
      return options.env?.CI === "true" ? { status: 0, stdout: "", stderr: "" }
        : { status: 1, stdout: "", stderr: "ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY" };
    }
    assert.equal(options.env, undefined, "CI override belongs only to the install");
    if (executable === "git" && args[0] === "status") {
      statusReads += 1;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (executable === "git" && args[0] === "symbolic-ref") return { status: 1, stdout: "", stderr: "" };
    if (executable === "git" && args[0] === "rev-parse") return { status: 0, stdout: `${TARGET}\n`, stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = applyRuntimeRelease({ root, targetSha: TARGET, runCommand: run });
  assert.equal(result.state, "UPDATED");
  assert.equal(statusReads, 2);
  assert.ok(calls.includes("git fetch --quiet --no-tags origin main"));
  assert.ok(calls.includes(`git merge-base --is-ancestor ${TARGET} origin/main`));
  assert.ok(calls.includes(`git switch --detach ${TARGET}`));
  assert.ok(calls.some((line) => /pnpm install --frozen-lockfile$/.test(line)));
  assert.equal(calls.some((line) => /^git (?:commit|push|merge)(?: |$)/.test(line)), false);
});

test("a dirty runtime refuses before fetch/switch and leaves ignored host evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-runtime-release-held-"));
  const calls: string[] = [];
  const result = applyRuntimeRelease({
    root,
    targetSha: TARGET,
    runCommand: (executable, args) => {
      calls.push(`${executable} ${args.join(" ")}`);
      return args[0] === "status"
        ? { status: 0, stdout: " M tracked.ts\n", stderr: "" }
        : { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.state, "REFUSED");
  assert.equal(result.code, "RUNTIME_CHECKOUT_DIRTY");
  assert.equal(calls.length, 1);
  const hold = JSON.parse(readFileSync(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH), "utf8")) as { code: string; targetSha: string };
  assert.equal(hold.code, "RUNTIME_CHECKOUT_DIRTY");
  assert.equal(hold.targetSha, TARGET);
});

test("failed or interrupted frozen installs resume on the switched checkout before admitting work", () => {
  for (const interrupted of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "wtp-runtime-install-recovery-"));
    const run = (_executable: string, args: readonly string[]): CommandResult => {
      if (args.includes("install")) {
        const hold = JSON.parse(readFileSync(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH), "utf8"));
        assert.equal(hold.switched, true, "recovery marker must exist before a watchdog kill");
        if (interrupted) throw new Error("fixture watchdog interruption");
        return { status: 1, stdout: "", stderr: "fixture install failed" };
      }
      return { status: args[0] === "symbolic-ref" ? 1 : 0,
        stdout: args[0] === "rev-parse" ? TARGET : "", stderr: "" };
    };
    if (interrupted) assert.throws(() => applyRuntimeRelease({ root, targetSha: TARGET, runCommand: run }), /fixture watchdog/);
    else assert.equal(applyRuntimeRelease({ root, targetSha: TARGET, runCommand: run }).code, "FROZEN_INSTALL_FAILED");
    writeRuntimeReleaseHold(root, { state: "HELD", code: "ADMIN_REPORT", targetSha: null });
    const calls: string[] = [];
    const recovered = resumeRuntimeReleaseInstall({ root, runCommand: (executable, args, options) => {
      calls.push(`${executable} ${args.join(" ")}`);
      if (args.includes("install")) assert.equal(options.env?.CI, "true");
      return { status: 0, stdout: args[0] === "rev-parse" ? TARGET : "", stderr: "" };
    } });
    assert.equal(recovered?.state, "UPDATED");
    assert.equal(calls.filter(line => line.includes("install --frozen-lockfile")).length, 1);
    assert.equal(calls.some(line => /git (fetch|switch)/.test(line)), false);
    assert.equal(existsSync(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH)), false);
    assert.equal(resumeRuntimeReleaseInstall({ root, runCommand: () => { throw new Error("must not reinstall twice"); } }), null);
  }
});

test("install recovery retains its marker on another failure and never installs a different checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-runtime-install-held-"));
  writeRuntimeReleaseHold(root, { switched: true, targetSha: TARGET });
  let installs = 0;
  const run = (_exe: string, args: readonly string[]): CommandResult => {
    if (args.includes("install")) installs++;
    return { status: 1, stdout: "", stderr: "fixture" };
  };
  assert.equal(resumeRuntimeReleaseInstall({ root, runCommand: run })?.code, "RUNTIME_CHECKOUT_EXACT_HEAD_FAILED");
  assert.equal(installs, 0);
  assert.equal(JSON.parse(readFileSync(join(root, RUNTIME_RELEASE_HOLD_RELATIVE_PATH), "utf8")).switched, true);
});

test("the server launcher recovers installation before importing runner dependencies", () => {
  const launch = readFileSync(new URL("../scripts/pilot-runtime-launch.mjs", import.meta.url), "utf8");
  const recover = launch.indexOf("const recoveredInstall = resumeRuntimeReleaseInstall({ root });");
  const refuse = launch.indexOf('process.exit(2);', recover);
  const spawn = launch.indexOf("const child = spawn(");
  assert.ok(recover >= 0 && recover < refuse && refuse < spawn);
  assert.equal(launch.slice(0, recover).includes("pilot-runner.mts"), false);
});
