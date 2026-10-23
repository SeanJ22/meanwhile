import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { routineSupervisorOuterEvidence } from "../lib/civic-data/runner-receipt.ts";
import { FATAL_LINE_PREFIX, childFatalLine, fatalLine } from "../lib/ops/fatal-line.ts";

function die(body: string) {
  const script = [
    "const { installFatalLine } = await import('./lib/ops/fatal-line.ts');",
    "let step = 'reading the routine task clocks';",
    "installFatalLine('routine-civic-data-runner', () => step);",
    body,
  ].join("\n");
  return spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
  });
}

const SECRET_URL = "postgres://routine_writer:s3cr3t-password@ep-quiet-sky-123456.us-east-2.aws.neon.tech/neondb";

test("a rejected top-level await exits 1 through one sanitized fatal line naming the step", () => {
  const run = die(`await Promise.reject(new Error("Error connecting to database ${SECRET_URL}"));`);
  assert.equal(run.status, 1, run.stderr);
  const lines = run.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, run.stdout);
  assert.ok(lines[0]!.startsWith(`${FATAL_LINE_PREFIX}routine-civic-data-runner: reading the routine task clocks — `), lines[0]);
  assert.match(lines[0]!, /Error connecting to database/);
  assert.doesNotMatch(lines[0]!, /s3cr3t-password|routine_writer/, "the fatal line carried a credential");
});

test("an unhandled rejection and a thrown callback end the same way", () => {
  const rejection = die("step = 'taking the host-local singleton'; Promise.reject(new Error('listen EACCES: permission denied')); setInterval(() => {}, 1000);");
  assert.equal(rejection.status, 1, rejection.stderr);
  assert.match(rejection.stdout, /^RCD_FATAL routine-civic-data-runner: taking the host-local singleton — .*listen EACCES: permission denied/m);

  const thrown = die("step = 'running the source pass'; setTimeout(() => { throw new TypeError('clock is undefined'); }, 0);");
  assert.equal(thrown.status, 1, thrown.stderr);
  assert.match(thrown.stdout, /^RCD_FATAL routine-civic-data-runner: running the source pass — TypeError: clock is undefined$/m);
});

test("an installed fatal recorder finishes saving the cause before the process exits", () => {
  const script = [
    "const { installFatalLine, installFatalRecorder } = await import('./lib/ops/fatal-line.ts');",
    "installFatalRecorder(async record => { await new Promise(resolve => setTimeout(resolve, 20)); const { writeSync } = await import('node:fs'); writeSync(1, 'SAVED=' + JSON.stringify(record) + '\\n'); });",
    "installFatalLine('publish-now-runner', () => 'reading its contract file');",
    "setTimeout(() => { throw Error('CONTRACT_FILE_UNREADABLE'); }, 0);",
  ].join("\n");
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script],
    { cwd: process.cwd(), encoding: "utf8", timeout: 60_000, env });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /SAVED=.*CONTRACT_FILE_UNREADABLE/);
});

test("the parent reads the child's fatal line and still never its raw stderr", () => {
  const output = [
    `raw stderr the parent must not quote: ${SECRET_URL}`,
    fatalLine("routine-civic-data-runner", "taking the host-local singleton", new Error("listen EACCES: permission denied")),
  ].join("\r\n");
  const quoted = childFatalLine(output);
  assert.match(quoted ?? "", /^routine-civic-data-runner: taking the host-local singleton — .*listen EACCES: permission denied$/);
  assert.doesNotMatch(quoted ?? "", /s3cr3t-password|raw stderr/);
  assert.equal(childFatalLine(`raw ${SECRET_URL}`), null);
  assert.equal(childFatalLine(`${FATAL_LINE_PREFIX}x: y — ${"z".repeat(900)}`)?.length, 600);

  // The outer evidence itself still reads protocol lines only.
  const outer = routineSupervisorOuterEvidence({ output, termination: "EXITED", exitStatus: 1 });
  assert.equal(outer.code, "ROUTINE_CHILD_EXITED");
  assert.doesNotMatch(outer.detail, /s3cr3t-password|raw stderr/);
});

test("the pilot's outer incident quotes the fatal line it reads", () => {
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  const incident = pilot.slice(pilot.indexOf("async function persistOuterRoutineChildFailure("));
  assert.ok(incident.length > 0, "the pilot no longer has its outer incident writer");
  const body = incident.slice(0, incident.indexOf("\n}\n"));
  assert.match(body, /const fatal = childFatalLine\(output\);/);
  assert.match(body, /The child's own last line: \$\{fatal\}\./);
});

test("the routine runner installs the fatal line before its first statement that can throw", () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const install = source.indexOf('installFatalLine("routine-civic-data-runner", () => step);');
  assert.ok(install > 0, "the routine runner no longer installs its fatal line");
  for (const later of ["routineTaskSelection(", "assertRuntimeAuthority(", "acquireProcessSingleton(", "prepareProductionCivicDataWrite();"]) {
    const at = source.indexOf(later, source.indexOf("\nconst ROOT"));
    assert.ok(at > install, `${later} runs before the fatal line is installed`);
  }
});

test("a Reader repair child that dies before its protocol names its step and cause in the line the supervisor quotes", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // Never a production handle: this child must die at admission, before any connection.
    if (/^(WTP_|DATABASE_URL|NETLIFY_|PG)/i.test(key)) delete env[key];
  }
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/routine-civic-data-reader-repair.mts",
    "--contract=registration-nc", "--observed-at=2026-09-25T23:01:35.000Z"], { cwd: process.cwd(), encoding: "utf8", env, timeout: 120_000 });
  assert.equal(run.status, 1, run.stderr);
  const quoted = childFatalLine(run.stdout);
  assert.match(quoted ?? "", /^routine-civic-data-reader-repair: admitting the production write — (?:\w+: )?WTP_PRODUCTION_DATABASE_URL_WRITE is not set/);

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const failure = runner.slice(runner.indexOf("function readerDomainExecutionFailure("));
  const body = failure.slice(0, failure.indexOf("\n}\n"));
  assert.match(body, /detail: childFatalLine\(run\.stdout\) \?\? safeFailure\(/, "the supervisor no longer quotes a Reader child's fatal line");
});
