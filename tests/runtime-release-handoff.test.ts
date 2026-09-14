import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RUNTIME_RELEASE_HOLD_RELATIVE_PATH,
  applyRuntimeRelease,
  fetchGithubCheckRuns,
  githubRepositoryFromOrigin,
  inspectRuntimeReleaseEvidence,
  requiredContextEvidence,
  runtimeGithubCredential,
  type CommandResult,
  type GithubCheckRun,
} from "../lib/ops/runtime-release-handoff.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-contexts.ts";
import type { ProductionIntegrityRead } from "../lib/ops/production-integrity-data-plane.ts";

const RUNNING = "1".repeat(40);
const TARGET = "2".repeat(40);

test("standing runtime preserves configured GitHub credentials without invoking the CLI", () => {
  const runCommand = (): never => { throw new Error("configured credentials must not be replaced"); };
  assert.equal(runtimeGithubCredential({ root: ".", env: { GH_TOKEN: "configured", GITHUB_TOKEN: "other" }, runCommand }), "configured");
  assert.equal(runtimeGithubCredential({ root: ".", env: { GITHUB_TOKEN: "other" }, runCommand }), "other");
});

test("standing runtime reuses only the existing github.com CLI login in memory", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-auth-"));
  const calls: unknown[] = [];
  const token = runtimeGithubCredential({ root, env: {}, runCommand: (exe, args, options) => {
    calls.push([exe, args, options]);
    return { status: 0, stdout: "fixture_cli_token\r\n", stderr: "" };
  } });
  assert.equal(token, "fixture_cli_token");
  assert.deepEqual(calls, [["gh", ["auth", "token", "--hostname", "github.com"], { cwd: root, timeoutMs: 15_000 }]]);
});

test("missing, failed, malformed and multiple CLI credentials preserve the certification refusal", () => {
  for (const result of [
    { status: 1, stdout: "fixture_secret", stderr: "fixture_secret" },
    { status: null, stdout: "fixture_secret", stderr: "timeout" },
    { status: 0, stdout: "", stderr: "" },
    { status: 0, stdout: "first_secret\nsecond_secret", stderr: "" },
    { status: 0, stdout: "token: fixture_secret", stderr: "" },
  ]) assert.equal(runtimeGithubCredential({ root: ".", env: {}, runCommand: () => result }), null);
  assert.equal(runtimeGithubCredential({ root: ".", env: {}, runCommand: () => { throw new Error("fixture_secret"); } }), null);
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(runner, /token: runtimeGithubCredential\(\{ root: ROOT, env: process\.env \}\)/);
  assert.equal(inspectRuntimeReleaseEvidence({ runningSha: TARGET, served: { sha: TARGET, how: "fixture", httpStatus: 200 }, integrity: integrity(), checkRuns: null }).code, "SOFTWARE_CERTIFICATION_UNREADABLE");
});

function checks(conclusion: string | null = "success"): GithubCheckRun[] {
  return REQUIRED_CONTEXTS.map((name, index) => ({
    name,
    conclusion,
    completed_at: `2026-09-09T00:00:0${index}Z`,
    id: index,
  }));
}

function integrity(sha = TARGET, observed: "HELD" | "REFUSED" = "HELD"): ProductionIntegrityRead {
  const record = {
    formatVersion: 1 as const,
    deployedSha: sha,
    mainSha: sha,
    observed,
    failureClass: null,
    detail: `${observed} in fixture`,
    observedAt: "2026-09-09T00:00:00.000Z",
    moment: "post-deploy" as const,
    gateExit: observed === "HELD" ? 0 as const : 1 as const,
  };
  return {
    kind: "HELD",
    record,
    receipt: {
      formatVersion: 1,
      id: `fixture:${sha}`,
      stagingSha: sha,
      deployId: null,
      section: null,
      decision: "POST_DEPLOY_INTEGRITY",
      raisedStateChoice: null,
      feedback: null,
      actor: "fixture",
      composedFrom: null,
      createdAt: record.observedAt,
      manifest: { prompt3Status: null, reviewState: null, stagingBoundary: null, reportedAt: null },
      productionIntegrity: record,
      sourceRunId: "fixture",
    },
  };
}

test("the exact served, integrity-held, fully certified SHA is current or requires one handoff", () => {
  const update = inspectRuntimeReleaseEvidence({
    runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    integrity: integrity(),
    checkRuns: checks(),
  });
  assert.equal(update.state, "UPDATE_REQUIRED");
  assert.equal(update.targetSha, TARGET);
  assert.deepEqual(update.reliedOn, REQUIRED_CONTEXTS);

  const current = inspectRuntimeReleaseEvidence({
    runningSha: TARGET,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    integrity: integrity(),
    checkRuns: checks(),
  });
  assert.equal(current.state, "CURRENT");
});

test("handoff fails closed on short/unknown served SHA, stale or refused integrity, and unreadable certification", () => {
  const base = {
    runningSha: RUNNING,
    served: { sha: TARGET, how: "fixture /api/build", httpStatus: 200 },
    integrity: integrity(),
    checkRuns: checks(),
  };
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, served: { ...base.served, sha: TARGET.slice(0, 7) } }).code, "DEPLOYED_SHA_UNRESOLVED");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, integrity: integrity(RUNNING) }).code, "POST_DEPLOY_INTEGRITY_NOT_HELD_FOR_TARGET");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, integrity: integrity(TARGET, "REFUSED") }).code, "POST_DEPLOY_INTEGRITY_NOT_HELD_FOR_TARGET");
  assert.equal(inspectRuntimeReleaseEvidence({ ...base, checkRuns: null }).code, "SOFTWARE_CERTIFICATION_UNREADABLE");
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
  const run = (executable: string, args: readonly string[]): CommandResult => {
    calls.push(`${executable} ${args.join(" ")}`);
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
