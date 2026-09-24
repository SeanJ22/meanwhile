import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { routineSupervisorOuterEvidence } from "../lib/civic-data/runner-receipt.ts";
import { FATAL_LINE_PREFIX, fatalLine } from "../lib/ops/fatal-line.ts";

/**
 * **A CHILD THAT DIES SAYS WHY, IN A LINE ITS PARENT MAY QUOTE.** (2026-09-24.)
 *
 * The routine civic-data child died at startup at 03:54Z, 06:56Z and 11:34Z
 * on 2026-09-24. Each time the digest said only "terminated=EXITED; exit=1;
 * launch plan=not exactly recorded", because the parent never quotes raw
 * stderr. The child now ends through one sanitized `RCD_FATAL` line naming
 * its step, and the parent's evidence quotes that line and nothing else.
 */

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

test("the parent's evidence quotes the child's fatal line and still never its raw stderr", () => {
  const output = [
    `raw stderr the parent must not quote: ${SECRET_URL}`,
    fatalLine("routine-civic-data-runner", "taking the host-local singleton", new Error("listen EACCES: permission denied")),
  ].join("\n");
  const evidence = routineSupervisorOuterEvidence({ output, termination: "EXITED", exitStatus: 1 });
  assert.equal(evidence.code, "ROUTINE_CHILD_EXITED");
  assert.match(evidence.detail, /The child's own last line: routine-civic-data-runner: taking the host-local singleton — .*listen EACCES: permission denied\./);
  assert.doesNotMatch(evidence.detail, /s3cr3t-password|raw stderr/);

  const silent = routineSupervisorOuterEvidence({ output: `raw ${SECRET_URL}`, termination: "EXITED", exitStatus: 1 });
  assert.doesNotMatch(silent.detail, /own last line|s3cr3t/);
});

test("the routine runner installs the fatal line before its first statement that can throw", () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const install = source.indexOf('installFatalLine("routine-civic-data-runner", () => step);');
  assert.ok(install > 0, "the routine runner no longer installs its fatal line");
  for (const later of ["routineTaskSelection(", "assertRuntimeAuthority(", "acquireProcessSingleton(", "resolveProductionWriteHandle();"]) {
    const at = source.indexOf(later, source.indexOf("\nconst ROOT"));
    assert.ok(at > install, `${later} runs before the fatal line is installed`);
  }
});
