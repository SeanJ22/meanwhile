import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * **THE RUNNER'S RELAUNCH PATH IS A TRIGGER, NOT A SETTING.**
 * (Autonomous-scout session, 2026-09-01.)
 *
 * Measured on this host: the Scheduled Task's `RestartCount 999 /
 * RestartInterval PT5M` did NOT relaunch a runner killed with
 * `Stop-Process -Force` (task at Ready, 0xFFFFFFFF, nothing after 8 minutes).
 * What does relaunch it is a second trigger that repeats every five minutes
 * for years, with `MultipleInstances IgnoreNew` making every firing a no-op
 * while the runner lives.
 *
 * These tests read `scripts/pilot-task.ps1` as TEXT and hold three things:
 *
 *   1. `-Action install` registers that repetition trigger BESIDE the at-logon
 *      trigger, with a five-minute interval and a multi-year duration.
 *   2. `-Action prove-relaunch` refuses (exit 2) before it kills anything when
 *      the relaunch trigger is not on the live task.
 *   3. `-Action status` derives trigger presence from `Get-ScheduledTask`,
 *      never from a constant or a flag.
 *
 * Each checker is a pure function of the script text, and each has a POSITIVE
 * CONTROL: a mutated copy that drops the guarded property must FAIL it.
 * Without the control a checker that matched nothing would stay green forever.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "pilot-task.ps1");

function scriptText(): string {
  // The script is `eol=lf` in .gitattributes; normalise anyway so a CRLF working
  // copy cannot turn a backtick continuation into a non-match.
  return readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
}

/** The body of one `"<action>" { ... }` case in the script's switch. */
function actionBlock(src: string, action: string): string {
  const open = src.indexOf(`"${action}" {`);
  assert.ok(open >= 0, `no "${action}" case in the switch`);
  const rest = src.slice(open + action.length + 4);
  // The next case starts at column 4 with a quoted name; the switch's closing
  // brace is at column 0. Whichever comes first ends this block.
  const next = rest.search(/\n {4}"[a-z-]+" \{|\n\}/);
  assert.ok(next > 0, `"${action}" case never ends`);
  return rest.slice(0, next);
}

/** Resolve `New-TimeSpan -<Unit> <literal|$Var>` against the script's constants. */
function timeSpanValue(src: string, expr: string, unit: "Minutes" | "Days"): number {
  const m = expr.match(new RegExp(`New-TimeSpan -${unit} (\\$\\w+|\\d+)`));
  if (!m) throw new Error(`no New-TimeSpan -${unit} in ${expr}`);
  if (/^\d+$/.test(m[1])) return Number(m[1]);
  const def = src.match(new RegExp(`^\\${m[1]}\\s*=\\s*(\\d+)\\s*$`, "m"));
  if (!def) throw new Error(`${m[1]} is not a numeric constant in the script`);
  return Number(def[1]);
}

/** 1. install registers a 5-minute, multi-year repetition trigger beside AtLogOn. */
function checkInstallRegistersRelaunchTrigger(src: string): void {
  const block = actionBlock(src, "install");

  const logon = block.match(/\$(\w+)\s*=\s*New-ScheduledTaskTrigger -AtLogOn/);
  assert.ok(logon, "install does not create an AtLogOn trigger");

  // A PowerShell statement continues across lines that end in a backtick:
  // consume every such line, then the final one.
  const repeat = block.match(/\$(\w+)\s*=\s*New-ScheduledTaskTrigger -Once(?:[^\n]*`\n)*[^\n]*/);
  assert.ok(repeat, "install does not create a -Once repetition trigger");
  const repeatExpr = repeat[0];
  assert.match(repeatExpr, /-RepetitionInterval \(New-TimeSpan/, "the -Once trigger has no -RepetitionInterval");
  assert.match(repeatExpr, /-RepetitionDuration \(New-TimeSpan/, "the -Once trigger has no -RepetitionDuration");

  const intervalMinutes = timeSpanValue(src, repeatExpr.split("-RepetitionInterval")[1], "Minutes");
  assert.equal(intervalMinutes, 5, `repetition interval is ${intervalMinutes} minutes, not 5`);
  const durationDays = timeSpanValue(src, repeatExpr.split("-RepetitionDuration")[1], "Days");
  assert.ok(durationDays >= 730, `repetition duration is ${durationDays} days; multi-year means at least 730`);

  const register = block.match(/Register-ScheduledTask(?:[^\n]*`\n)*[^\n]*/);
  assert.ok(register, "install never calls Register-ScheduledTask");
  const triggerArg = register[0].match(/-Trigger\s+@\(([^)]*)\)/);
  assert.ok(triggerArg, "Register-ScheduledTask does not pass an array of triggers");
  const names = triggerArg[1].split(",").map((s) => s.trim());
  assert.ok(names.includes(`$${logon[1]}`), `the AtLogOn trigger $${logon[1]} is not registered`);
  assert.ok(names.includes(`$${repeat[1]}`), `the repetition trigger $${repeat[1]} is not registered`);
}

/** 2. prove-relaunch refuses, exit 2, before any Stop-Process, when the trigger is absent. */
function checkProveRelaunchRefusesWithoutTrigger(src: string): void {
  const block = actionBlock(src, "prove-relaunch");
  const kill = block.indexOf("Stop-Process");
  assert.ok(kill >= 0, "prove-relaunch never kills the runner, so it measures nothing");

  const guard = block.match(/if \(-not \$\w+\.relaunchTriggerPresent\) \{[\s\S]*?exit 2/);
  assert.ok(guard, "prove-relaunch has no `if (-not $facts.relaunchTriggerPresent) { ... exit 2 }` guard");
  assert.ok(
    (guard.index ?? Infinity) < kill,
    "the relaunch-trigger guard comes AFTER Stop-Process; the runner would be dead before the refusal",
  );
}

/** 3. status derives presence from Get-ScheduledTask -> Triggers -> Repetition, never a constant. */
function checkStatusDerivesPresenceFromLiveTask(src: string): void {
  const status = actionBlock(src, "status");
  assert.match(status, /Get-TaskFacts/, "status does not call Get-TaskFacts");
  assert.match(
    status,
    /relaunchTriggerPresent|Write-TriggerLines/,
    "status neither reads relaunchTriggerPresent nor prints the trigger lines",
  );

  const facts = src.match(/function Get-TaskFacts \{[\s\S]*?\n\}/);
  assert.ok(facts, "no Get-TaskFacts function");
  assert.match(facts[0], /Get-ScheduledTask -TaskName/, "Get-TaskFacts does not read the live task");
  assert.match(facts[0], /relaunchTriggerPresent\s*=\s*\$\w+/, "Get-TaskFacts does not set relaunchTriggerPresent");
  assert.doesNotMatch(
    facts[0],
    /relaunchTriggerPresent\s*=\s*\$(true|false)\b/i,
    "relaunchTriggerPresent is a literal boolean, not a derivation",
  );
  assert.match(facts[0], /Test-RelaunchTrigger \$task/, "Get-TaskFacts does not derive presence via Test-RelaunchTrigger");

  const derive = src.match(/function Test-RelaunchTrigger \{[\s\S]*?\n\}/);
  assert.ok(derive, "no Test-RelaunchTrigger function");
  assert.match(derive[0], /\.Triggers/, "Test-RelaunchTrigger does not read the task's Triggers");
  assert.match(derive[0], /Repetition/, "Test-RelaunchTrigger does not read a trigger's Repetition");
  assert.match(derive[0], /Interval/, "Test-RelaunchTrigger does not judge the repetition Interval");
  const firstTrue = derive[0].search(/return \$true/);
  assert.ok(firstTrue >= 0, "Test-RelaunchTrigger can never return $true");
  assert.ok(
    derive[0].indexOf("Repetition") < firstTrue,
    "Test-RelaunchTrigger returns $true before looking at any repetition",
  );

  // And the same derivation feeds verify-triggers and prove-relaunch.
  assert.match(actionBlock(src, "verify-triggers"), /Get-TaskFacts/, "verify-triggers bypasses Get-TaskFacts");
  assert.match(actionBlock(src, "prove-relaunch"), /Get-TaskFacts/, "prove-relaunch bypasses Get-TaskFacts");
}

function fails(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

test("install registers the 5-minute multi-year relaunch trigger beside AtLogOn", () => {
  checkInstallRegistersRelaunchTrigger(scriptText());
});

test("prove-relaunch refuses (exit 2) before killing anything when the trigger is absent", () => {
  checkProveRelaunchRefusesWithoutTrigger(scriptText());
});

test("status derives relaunch-trigger presence from the live task, not a constant", () => {
  checkStatusDerivesPresenceFromLiveTask(scriptText());
});

test("verify-triggers exits on the derived presence and prove-relaunch writes the typed record", () => {
  const src = scriptText();
  const verify = actionBlock(src, "verify-triggers");
  assert.match(verify, /if \(\$\w+\.relaunchTriggerPresent\) \{ exit 0 \} else \{ exit 1 \}/);
  const prove = actionBlock(src, "prove-relaunch");
  for (const key of [
    "measuredAt",
    "killedPid",
    "relaunchedPid",
    "secondsToRelaunch",
    "relaunchTriggerPresent",
    "taskStateAfter",
    "lastTaskResult",
    "verdict",
  ]) {
    assert.match(prove, new RegExp(`^\\s*${key}\\s*=`, "m"), `the proof record lacks ${key}`);
  }
  assert.match(prove, /"RELAUNCHED"/);
  assert.match(prove, /"NOT_RELAUNCHED"/);
  assert.match(src, /runner-relaunch-proof\.json/, "the proof record has no fixed path");
});

test("POSITIVE CONTROL: dropping the repetition trigger from install fails the checker", () => {
  const src = scriptText();
  // (a) The -Once trigger is created but never registered.
  const unregistered = src.replace(/-Trigger\s+@\(\$logonTrigger, \$relaunchTrigger\)/, "-Trigger @($logonTrigger)");
  assert.notEqual(unregistered, src, "the mutation did not apply; the test would prove nothing");
  assert.ok(fails(() => checkInstallRegistersRelaunchTrigger(unregistered)), "an install with only AtLogOn passed");

  // (b) The interval is an hour, not five minutes.
  const slow = src.replace(/^\$RelaunchIntervalMinutes\s*=\s*5\s*$/m, "$RelaunchIntervalMinutes = 60");
  assert.notEqual(slow, src);
  assert.ok(fails(() => checkInstallRegistersRelaunchTrigger(slow)), "a 60-minute repetition passed as 5");

  // (c) The duration is one day, not years.
  const brief = src.replace(/^\$RelaunchDurationDays\s*=\s*3650\s*$/m, "$RelaunchDurationDays = 1");
  assert.notEqual(brief, src);
  assert.ok(fails(() => checkInstallRegistersRelaunchTrigger(brief)), "a one-day repetition passed as multi-year");

  // (d) The repetition is gone entirely and the trigger is a plain -Once.
  const bare = src.replace(/ `\n\s*-RepetitionInterval[^\n]*`\n\s*-RepetitionDuration[^\n]*/, "");
  assert.notEqual(bare, src);
  assert.ok(fails(() => checkInstallRegistersRelaunchTrigger(bare)), "a -Once trigger with no repetition passed");
});

test("POSITIVE CONTROL: removing the prove-relaunch guard fails the checker", () => {
  const src = scriptText();
  const unguarded = src.replace(
    /if \(-not \$facts\.relaunchTriggerPresent\) \{[\s\S]*?exit 2\s*\n\s*\}/,
    "",
  );
  assert.notEqual(unguarded, src);
  assert.ok(fails(() => checkProveRelaunchRefusesWithoutTrigger(unguarded)), "a prove-relaunch that kills without checking passed");
});

test("POSITIVE CONTROL: a constant relaunchTriggerPresent fails the checker", () => {
  const src = scriptText();
  const constant = src.replace(/relaunchTriggerPresent\s*=\s*\$relaunch\b/, "relaunchTriggerPresent = $true");
  assert.notEqual(constant, src);
  assert.ok(fails(() => checkStatusDerivesPresenceFromLiveTask(constant)), "a hard-coded $true passed as a derivation");

  const blind = src.replace(/\$relaunch = Test-RelaunchTrigger \$task/, "$relaunch = $false");
  assert.notEqual(blind, src);
  assert.ok(fails(() => checkStatusDerivesPresenceFromLiveTask(blind)), "a presence that never reads the task passed");
});
