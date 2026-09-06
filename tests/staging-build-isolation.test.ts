import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "npg_PLANTED_BUILD_COLLISION_SECRET";
const PROD = "ep-still-water-a1b2c3.us-east-2.aws.neon.tech";
const STAGE = "ep-bold-meadow-z9y8x7.us-east-2.aws.neon.tech";
const CP_PROD = "ep-hidden-river-a2b3c4.us-east-2.aws.neon.tech";
const CP_STAGE = "ep-young-moon-z8y7x6.us-east-2.aws.neon.tech";
const url = (host: string) => `postgresql://canary_fixture:${SECRET}@${host}/neondb?sslmode=require`;

/** Read literal TOML string settings; an unsupported shape fails the test. */
function setting(section: string, key: string): string | undefined {
  let current = "";
  for (const line of readFileSync(join(ROOT, "netlify.toml"), "utf8").split(/\r?\n/)) {
    const table = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (table) current = table[1];
    if (current !== section) continue;
    const assignment = /^\s*([a-z_]+)\s*=\s*(".*")\s*$/.exec(line);
    if (assignment?.[1] === key) return JSON.parse(assignment[2]);
  }
  return undefined;
}

function branchCommand(): string {
  // A branch-specific command outranks the generic branch context in Netlify.
  const command = setting("context.test", "command") ?? setting('context."test"', "command") ??
    setting("context.branch-deploy", "command") ?? setting("build", "command");
  assert.ok(command, "the effective test branch build command must be measurable");
  return command;
}

function runBranch(overrides: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wtp-staging-build-"));
  try {
    const wrapper = process.platform === "win32" ? "corepack.cmd" : "corepack";
    writeFileSync(join(dir, wrapper), process.platform === "win32"
      ? '@"%SISO_NODE%" "%SISO_SHIM%" %*\r\n@exit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexec "$SISO_NODE" "$SISO_SHIM" "$@"\n', { mode: 0o755 });
    const buildMarker = join(dir, "build-started");
    const trace = join(dir, "commands.jsonl");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SISO_NODE: process.execPath,
      SISO_SHIM: join(ROOT, "tests", "fixtures", "staging-build", "corepack.mjs"),
      SISO_ROOT: ROOT,
      SISO_BUILD_MARKER: buildMarker,
      SISO_TRACE: trace,
      CONTEXT: "branch-deploy",
      DATABASE_URL: url(STAGE),
      WTP_CONTROL_PLANE_DATABASE_URL: url(CP_STAGE),
      WTP_BUILD_PRODUCTION_DATABASE_HOST: PROD,
      WTP_BUILD_STAGING_DATABASE_HOST: STAGE,
      WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST: CP_PROD,
      WTP_BUILD_STAGING_CONTROL_PLANE_HOST: CP_STAGE,
      ...overrides,
    };
    // Windows environment names are case-insensitive; keep exactly one PATH.
    const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
    const inheritedPath = pathKeys.map((key) => env[key]).find(Boolean) ?? "";
    for (const key of pathKeys) delete env[key];
    env.PATH = `${dir}${delimiter}${inheritedPath}`;
    const result = spawnSync(branchCommand(), {
      shell: process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh",
      cwd: ROOT, env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.error, undefined, "the isolated shell control must execute");
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.ok(!output.includes(SECRET), "the planted password escaped the executable gate");
    assert.ok(!output.includes("canary_fixture"), "the username escaped the executable gate");
    assert.ok(!output.includes("postgresql://"), "a connection string escaped the executable gate");
    return {
      status: result.status,
      output,
      built: existsSync(buildMarker),
      commands: existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [],
    };
  } finally {
    // `dir` is the single directory just created by mkdtemp, never user input.
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real Netlify branch command gates before Next and keeps previews disabled", () => {
  assert.equal(branchCommand(), "corepack enable && corepack pnpm run staging:isolation && corepack pnpm run build");
  assert.equal(setting("context.deploy-preview", "ignore"), "exit 0");
});

test("the actual branch command refuses a planted production collision before build", () => {
  const result = runBranch({ DATABASE_URL: url(PROD) });
  assert.equal(result.status, 1, result.output);
  assert.equal(result.built, false, "Next was invoked after the isolation gate refused production");
  assert.deepEqual(result.commands, [["enable"], ["pnpm", "run", "staging:isolation"]]);
  assert.match(result.output, /REFUSED.*DATABASE_URL/);
  assert.match(result.output, /SAME\s+endpoint/);
});

test("the actual branch command reaches build only after both staging destinations pass", () => {
  const result = runBranch();
  assert.equal(result.status, 0, result.output);
  assert.equal(result.built, true);
  assert.deepEqual(result.commands, [["enable"], ["pnpm", "run", "staging:isolation"], ["pnpm", "run", "build"]]);
  assert.match(result.output, /ISOLATED.*DATABASE_URL/);
  assert.match(result.output, /ISOLATED.*WTP_CONTROL_PLANE_DATABASE_URL/);
  assert.ok(result.output.includes(STAGE), "sanitized provider host evidence must be readable");
  assert.match(result.output, /database neondb/);
});

test("a production control-plane collision refuses even when the application is isolated", () => {
  const result = runBranch({ WTP_CONTROL_PLANE_DATABASE_URL: url(CP_PROD) });
  assert.equal(result.status, 1, result.output);
  assert.equal(result.built, false);
  assert.match(result.output, /REFUSED.*WTP_CONTROL_PLANE_DATABASE_URL/);
});

test("missing control-plane build scope is unmeasured and refuses before Next", () => {
  const result = runBranch({ WTP_CONTROL_PLANE_DATABASE_URL: undefined });
  assert.equal(result.status, 2, result.output);
  assert.equal(result.built, false);
  assert.match(result.output, /COULD NOT TELL.*WTP_CONTROL_PLANE_DATABASE_URL/);
});

test("unknown deploy context is refused by the executable gate", () => {
  const result = runBranch({ CONTEXT: "future-context" });
  assert.equal(result.status, 2, result.output);
  assert.equal(result.built, false);
});

test("malformed connection strings fail safe without exposing parser input", () => {
  for (const databaseUrl of [`postgresql://canary_fixture:${SECRET}@`, `://${SECRET}`, SECRET]) {
    const result = runBranch({ DATABASE_URL: databaseUrl });
    assert.equal(result.status, 2, result.output);
    assert.equal(result.built, false);
  }
});
