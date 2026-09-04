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

/* ==========================================================================
 * THE NIGHTLY WINDOW'S BACKUP WAKEUP (RULING 242, Lane E, 2026-09-02).
 *
 * `-Action install-window` registers "WeThePeople Nightly Window": a DAILY
 * trigger per host-local equivalent of 04:00 America/New_York, running
 * `scripts/nightly-window.mts --wakeup`, refused unelevated with the exact
 * elevated one-liner printed. Checked as text, with positive controls, like
 * the runner's installer above.
 * ======================================================================= */

/** 4. install-window registers a daily trigger derived from the Eastern zone, running --wakeup. */
function checkInstallWindow(src: string): void {
  const block = actionBlock(src, "install-window");
  assert.match(src, /^\$WindowTaskName\s*=\s*"WeThePeople Nightly Window"/m, "the window task has no fixed name");
  assert.match(src, /^\$WindowEasternZoneId\s*=\s*"Eastern Standard Time"/m, "the window zone is not the Eastern zone id");
  assert.match(src, /^\$WindowEasternHour\s*=\s*4\s*$/m, "the window hour is not 04:00");

  const args = src.match(/function Get-WindowArgs \{[\s\S]*?\n\}/);
  assert.ok(args, "no Get-WindowArgs function");
  assert.match(args[0], /scripts\/nightly-window\.mts --wakeup/, "the window task does not run nightly-window.mts --wakeup");
  assert.doesNotMatch(args[0], /--shadow|--force/, "the backup wakeup must not run the window directly; --wakeup decides");

  const times = src.match(/function Get-WindowLocalTimes \{[\s\S]*?\n\}/);
  assert.ok(times, "no Get-WindowLocalTimes function");
  assert.match(times[0], /FindSystemTimeZoneById\(\$WindowEasternZoneId\)/, "local times are not derived from the Eastern zone");
  assert.match(times[0], /ConvertTime/, "local times are not converted from Eastern to host-local");

  assert.match(block, /Get-WindowLocalTimes/, "install-window does not derive the local times");
  assert.match(block, /New-ScheduledTaskTrigger -Daily -At \$t/, "install-window does not create a daily trigger per local time");
  const register = block.match(/Register-ScheduledTask(?:[^\n]*`\n)*[^\n]*/);
  assert.ok(register, "install-window never calls Register-ScheduledTask");
  assert.match(register[0], /-TaskName \$WindowTaskName/, "the registration does not name the window task");
  assert.match(register[0], /-Trigger \$windowTriggers/, "the registration does not pass the daily triggers");
  assert.match(block, /Get-WindowArgs/, "install-window does not use Get-WindowArgs");

  const refusal = block.match(/catch \{[\s\S]*?\}/);
  assert.ok(refusal, "install-window has no catch for the unelevated refusal");
  assert.match(refusal[0], /\$WindowElevatedOneLiner/, "the refusal does not print the elevated one-liner");
  assert.match(src, /^\$WindowElevatedOneLiner\s*=\s*"powershell -NoProfile -ExecutionPolicy Bypass -File scripts\/pilot-task\.ps1 -Action install-window"/m);
  assert.match(block, /if \(-not \$windowLanded\) \{ exit 1 \}/, "a refused registration does not exit 1");
}

test("install-window registers a daily Eastern-derived trigger running nightly-window.mts --wakeup, and prints the elevated one-liner when refused", () => {
  checkInstallWindow(scriptText());
});

test("POSITIVE CONTROL: dropping the daily trigger, the --wakeup flag, or the one-liner fails the install-window checker", () => {
  const src = scriptText();
  const noDaily = src.replace("New-ScheduledTaskTrigger -Daily -At $t", "New-ScheduledTaskTrigger -AtLogOn");
  assert.notEqual(noDaily, src);
  assert.ok(fails(() => checkInstallWindow(noDaily)), "an install-window with no daily trigger passed");

  const noWakeup = src.replace("scripts/nightly-window.mts --wakeup", "scripts/nightly-window.mts --shadow");
  assert.notEqual(noWakeup, src);
  assert.ok(fails(() => checkInstallWindow(noWakeup)), "a task that runs the window directly passed as the backup wakeup");

  const noOneLiner = src.replace(/Write-Output "    \$WindowElevatedOneLiner"/, 'Write-Output "    see the docs"');
  assert.notEqual(noOneLiner, src);
  assert.ok(fails(() => checkInstallWindow(noOneLiner)), "a refusal that names no elevated command passed");

  const notEastern = src.replace(/^\$WindowEasternZoneId\s*=\s*"Eastern Standard Time"/m, '$WindowEasternZoneId = "US Mountain Standard Time"');
  assert.notEqual(notEastern, src);
  assert.ok(fails(() => checkInstallWindow(notEastern)), "a task derived from the wrong zone passed");
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

/* ==========================================================================
 * DISABLE JUDGES THE MEASURED END STATE, NOT THE FACT THAT COMMANDS RAN.
 * (Control-centre resource-safety closure, 2026-09-04.)
 *
 * The owner observed `pnpm pilot:disable` print
 *   "disabled: the runner is stopped and will not return at logon."
 * while `schtasks /Change /DISABLE` had answered "ERROR: Access is denied." and
 * the task was still Running with its relaunch trigger live. A native nonzero
 * exit does not throw, so the old fire-and-forget block claimed success over a
 * refused change. These checkers hold the repaired semantics as script text,
 * each with a positive control, exactly like the installer checkers above.
 * ======================================================================= */

/** 5. disable captures every schtasks exit, re-derives the live task, and only
 *  prints success behind (task Disabled|absent) AND no runner proc AND no startup. */
function checkDisableJudgesEndState(src: string): void {
  const block = actionBlock(src, "disable");

  // Every schtasks operation runs through the exit-code-returning helper, and
  // the /DISABLE result is CAPTURED and CHECKED — never issued and ignored.
  assert.match(block, /Invoke-Schtasks/, "disable does not route schtasks through the exit-code helper");
  assert.match(
    block,
    /\$(\w+)\s*=\s*Invoke-Schtasks @\("\/Change"[^)]*"\/DISABLE"\)/,
    "the /Change /DISABLE call's exit code is not captured into a variable",
  );
  assert.match(block, /\$disableCode -ne 0/, "the captured /DISABLE exit code is never checked against 0");

  // The verdict re-derives the live task AFTER acting, and judges on it.
  const rederive = block.indexOf("Get-TaskFacts");
  assert.ok(rederive >= 0, "disable never re-derives the live task with Get-TaskFacts");
  assert.ok(
    rederive > block.indexOf("/DISABLE"),
    "disable reads the task BEFORE issuing the disable, so it cannot see the result",
  );
  assert.match(block, /\$facts\.state -eq "Disabled"/, "disable does not require the task to be Disabled");
  assert.match(block, /-not \$facts\.taskPresent/, "disable does not accept an absent task as down");
  assert.match(block, /\$facts\.runningPids\.Count -eq 0/, "disable does not require zero runner processes");
  assert.match(block, /Test-Path \$StartupFile/, "disable does not check the startup fallback is gone");
  assert.match(
    block,
    /if \(\$taskDown -and \$noProcs -and \$noStartup\)/,
    "the success sentence is not guarded by the end-state conjunction",
  );

  // The success sentence exists ONLY after the state was measured, and the
  // failure path exits nonzero.
  const success = block.indexOf('"disabled:');
  assert.ok(success >= 0, "disable prints no success sentence at all");
  assert.ok(success > rederive, "the success sentence comes BEFORE the state was measured");
  assert.ok(block.indexOf("exit 0") > success, "there is no guarded exit 0 after the success sentence");
  assert.match(block, /exit 1/, "disable has no nonzero refusal path for a partial shutdown");
}

/** 6. status/Write-TriggerLines never calls a DISABLED task a five-minute relauncher. */
function checkTriggerLinesGuardsDisabled(src: string): void {
  const fn = src.match(/function Write-TriggerLines \{[\s\S]*?\n\}/);
  assert.ok(fn, "no Write-TriggerLines function");
  const body = fn[0];
  assert.match(body, /\$Facts\.state -eq "Disabled"/, "Write-TriggerLines does not read the task's disabled state");
  assert.match(body, /will NOT relaunch/i, "Write-TriggerLines has no inert-trigger message for a disabled task");

  // The relaunch claim is GATED behind the disabled check: a disabled task must
  // never reach it. Match the CLAIM (which carries $RelaunchIntervalMinutes),
  // not the prose "comes back within N minutes" that may appear in a comment.
  const disabledAt = body.indexOf('-eq "Disabled"');
  const relaunchClaim = body.indexOf("comes back within $RelaunchIntervalMinutes");
  assert.ok(relaunchClaim >= 0, "Write-TriggerLines never states the relaunch cadence");
  assert.ok(
    disabledAt >= 0 && disabledAt < relaunchClaim,
    "the disabled check does not precede (and gate) the five-minute relaunch claim",
  );
}

test("disable judges the measured end state and refuses success over a denied /Change", () => {
  checkDisableJudgesEndState(scriptText());
});

test("status never describes a DISABLED task as relaunching the runner in five minutes", () => {
  checkTriggerLinesGuardsDisabled(scriptText());
});

test("POSITIVE CONTROL: an unconditional or unchecked disable fails the checker", () => {
  const src = scriptText();

  // (a) The old fire-and-forget: no re-derivation, an unconditional success.
  const unconditional = src.replace(
    /\$facts = Get-TaskFacts\r?\n(\s*)\$taskDown  = /,
    "$1$taskDown  = ",
  );
  assert.notEqual(unconditional, src, "the mutation did not apply; the test would prove nothing");
  assert.ok(
    fails(() => checkDisableJudgesEndState(unconditional)),
    "a disable that never re-derives the live task passed",
  );

  // (b) The /DISABLE exit code is captured but never checked.
  const unchecked = src.replace(/\$disableCode -ne 0/, "$false");
  assert.notEqual(unchecked, src);
  assert.ok(
    fails(() => checkDisableJudgesEndState(unchecked)),
    "a disable that ignores the /Change exit code passed",
  );

  // (c) The end-state conjunction is widened to always-true.
  const ungated = src.replace(/if \(\$taskDown -and \$noProcs -and \$noStartup\)/, "if ($true)");
  assert.notEqual(ungated, src);
  assert.ok(
    fails(() => checkDisableJudgesEndState(ungated)),
    "a disable whose success is not gated on the end state passed",
  );
});

test("POSITIVE CONTROL: a state-blind Write-TriggerLines fails the disabled checker", () => {
  const src = scriptText();

  // (a) It stops reading the disabled state.
  const blind = src.replace(/\$taskDisabled = \(\$Facts\.state -eq "Disabled"\)/, "$taskDisabled = $false");
  assert.notEqual(blind, src);
  assert.ok(fails(() => checkTriggerLinesGuardsDisabled(blind)), "a Write-TriggerLines blind to the task state passed");

  // (b) The inert-trigger message becomes a relaunch promise.
  const promises = src.replace(
    /it still CARRIES a relaunch trigger definition, but a disabled task fires no trigger, so it will NOT relaunch the runner\. The definition is inert until the task is re-enabled\./,
    "a killed runner comes back within $RelaunchIntervalMinutes minutes.",
  );
  assert.notEqual(promises, src);
  assert.ok(
    fails(() => checkTriggerLinesGuardsDisabled(promises)),
    "a disabled-task message promising relaunch passed",
  );
});
