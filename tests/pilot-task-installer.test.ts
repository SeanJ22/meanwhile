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
const LAUNCHER = join(ROOT, "scripts", "pilot-runtime-launch.ps1");
const PACKAGE = join(ROOT, "package.json");

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

/** 2. prove-relaunch refuses before any kill unless one entrypoint is proven. */
function checkProveRelaunchRefusesWithoutTrigger(src: string): void {
  const block = actionBlock(src, "prove-relaunch");
  const kill = block.indexOf("Stop-RunnerProcessTrees");
  assert.ok(kill >= 0, "prove-relaunch never kills the complete runner process tree, so it measures nothing");

  const guard = block.match(/if \(-not \$\w+\.singleEntrypoint\) \{[\s\S]*?exit 2/);
  assert.ok(guard, "prove-relaunch has no `if (-not $facts.singleEntrypoint) { ... exit 2 }` guard");
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
  assert.match(facts[0], /startupEntryPresent\s*=\s*\[bool\]\(Test-Path \$StartupFile\)/, "Get-TaskFacts does not measure the competing Startup entry");
  assert.match(facts[0], /singleEntrypoint\s*=.*\$present.*\$relaunch.*-not \(Test-Path \$StartupFile\)/, "Get-TaskFacts does not require one task entrypoint");

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
  const verify = actionBlock(src, "verify-triggers");
  assert.match(verify, /Resolve-TaskRuntimeOrThrow/, "verify-triggers trusts trigger shape without validating the installed runtime");
  assert.match(verify, /Read-OnlyVerifiedRunnerOrThrow/, "verify-triggers does not prove exact process identity");
  assert.match(verify, /exit 1/, "verify-triggers has no refusing exit");
  assert.match(actionBlock(src, "prove-relaunch"), /Get-TaskFacts/, "prove-relaunch bypasses Get-TaskFacts");
}

/** A live Scheduled Task and the independent Startup launcher never coexist. */
function checkInstallKeepsOneEntrypoint(src: string): void {
  const block = actionBlock(src, "install");
  assert.match(block, /\$facts = Get-TaskFacts/, "install does not read back the live task before choosing a fallback");
  assert.match(block, /\$facts\.taskPresent -and \$facts\.state -ne "Disabled"/, "install does not recognize an already-active task after a refused registration");
  assert.match(
    block,
    /if \(\$taskLanded\) \{[\s\S]*?Remove-StartupEntryOrThrow[\s\S]*?\}\s*else \{\s*\$file = Install-StartupEntry/,
    "Startup is not structurally the fallback-only branch opposite removal for a live task",
  );
  assert.match(block, /active task exists without its required relaunch trigger\. No competing Startup clock was installed/);
  assert.match(src, /function Remove-StartupEntryOrThrow \{[\s\S]*?Remove-Item -LiteralPath \$StartupFile[\s\S]*?throw/);
  assert.doesNotMatch(block, /installed either way/i);
}

/** Initial install is exact; the persistent launcher is stable across certified handoffs. */
function checkInstallValidatesRuntimeBoundary(src: string): void {
  assert.match(src, /\[string\]\$RepoPath = ""/, "installer still defaults to a mutable checkout");
  assert.match(src, /\[string\]\$EnvFile = ""/, "installer still defaults to cwd-relative environment state");
  assert.match(src, /\[string\]\$ExpectedDeployedSha = ""/, "installer does not require a deployed SHA");
  const resolver = src.match(/function Resolve-RuntimeConfig \{[\s\S]*?\n\}/);
  assert.ok(resolver, "installer has no executable runtime-boundary validator");
  assert.match(resolver[0], /scripts\\pilot-runtime-config\.mjs/);
  assert.match(resolver[0], /Join-Path \(\[System\.IO\.Path\]::GetFullPath\(\$RepoPath\)\)/, "the installed target does not own its validator");
  assert.doesNotMatch(resolver[0], /Join-Path \$ScriptRepo .*pilot-runtime-config/, "an engineering checkout can certify a different runtime tree");
  assert.match(resolver[0], /rev-parse "\$\{ExpectedDeployedSha\}:scripts\/pilot-runtime-config\.mjs"/, "the target validator is not bound to the explicit deployed commit");
  assert.match(resolver[0], /hash-object --path="scripts\/pilot-runtime-config\.mjs" "scripts\/pilot-runtime-config\.mjs"/, "the target validator's worktree bytes are not measured through Git's clean filter");
  assert.match(resolver[0], /\$workingValidatorBlob -ne \$expectedValidatorBlob/, "a dirty replacement validator can certify itself");
  assert.match(resolver[0], /"--repo", \$RepoPath/);
  assert.match(resolver[0], /"--env-file", \$EnvFile/);
  assert.match(resolver[0], /"--expected-sha", \$ExpectedDeployedSha/);

  const args = src.match(/function Get-LauncherArgs \{[\s\S]*?\n\}/);
  assert.ok(args, "installer has no stable launcher argument builder");
  assert.match(args[0], /scripts\\pilot-runtime-launch\.ps1/, "task does not run the stable frozen-install launcher");
  assert.match(args[0], /-RepoPath \$\(Quote-TaskArgument \$RepoPath\)/, "task does not carry the validated clean repository path");
  assert.match(args[0], /-EnvFile \$\(Quote-TaskArgument \$EnvFile\)/, "task does not carry the validated absolute environment path");
  assert.doesNotMatch(args[0], /ExpectedDeployedSha|installed-sha/, "task freezes an installed SHA and would need owner reinstall after each release");
  assert.doesNotMatch(args[0], /\.env\.local/, "task still relies on cwd-relative .env.local");

  const install = actionBlock(src, "install");
  assert.ok(install.indexOf("Resolve-RuntimeConfig") < install.indexOf("New-ScheduledTaskAction"), "task registration occurs before runtime validation");
  assert.match(install, /New-ScheduledTaskAction -Execute \$powershell -Argument \$launcherArgs/);
  assert.match(install, /Test-SameResolvedPath \$facts\.workingDirectory \$RepoPath/);
  assert.match(install, /\[string\]\$facts\.arguments -eq \[string\]\$launcherArgs/);
  assert.match(src, /\.runtime\\ops\\runner-relaunch-proof\.json/, "relaunch proof can dirty the runtime checkout");
  assert.doesNotMatch(src, /Join-Path \$ScriptRepo "data\\ops\\runner-relaunch-proof\.json"/);
}

function checkStableLauncher(src: string): void {
  assert.match(src, /scripts\/pilot-runtime-config\.mjs/);
  assert.match(src, /"--expected-sha" \$head/, "relaunch does not revalidate the current exact detached HEAD");
  assert.match(src, /install --frozen-lockfile/, "a relaunched checkout can start before its frozen dependencies install");
  assert.match(src, /scripts\/pilot-runner\.mts .*--release-handoff/, "installed runtime does not opt into automatic exact-SHA handoff");
  assert.match(src, /"--env-file=\$EnvFile"/, "the parent does not load the absolute environment file");
  assert.doesNotMatch(src, /installed-sha|ExpectedDeployedSha/, "the stable relauncher embeds an immutable release SHA");
  assert.doesNotMatch(src, /Get-Content.*EnvFile|Write-Output.*EnvFile/, "the launcher reads or prints private environment content/path");
  for (const fact of [
    "WTP_RUNTIME_AUTHORITY_REPO",
    "WTP_RUNTIME_AUTHORITY_SHA",
    "WTP_RUNTIME_AUTHORITY_CAPABILITY",
    "WTP_RUNTIME_AUTHORITY_PARENT_PID",
    "WTP_RUNTIME_AUTHORITY_NONCE",
  ]) {
    assert.match(src, new RegExp(fact), `stable launcher does not mint ${fact}`);
  }
  assert.match(src, /WTP_RUNTIME_AUTHORITY_CAPABILITY\s*=\s*"STANDING_PARENT"/);
}

function checkHostControlProvesExactRuntime(src: string): void {
  const status = actionBlock(src, "status");
  assert.match(status, /Resolve-TaskRuntimeOrThrow|Resolve-StartupRuntimeOrThrow/);
  assert.match(status, /Read-OnlyVerifiedRunnerOrThrow/);
  assert.match(status, /STATUS REFUSED[\s\S]*exit 1/);

  const verify = actionBlock(src, "verify-triggers");
  assert.ok(verify.indexOf("Resolve-TaskRuntimeOrThrow") < verify.indexOf("Read-OnlyVerifiedRunnerOrThrow"));
  assert.match(verify, /stableLauncherVerified/);
  assert.match(verify, /processIdentityVerified/);

  const prove = actionBlock(src, "prove-relaunch");
  const kill = prove.indexOf("Stop-RunnerProcessTrees");
  assert.ok(prove.indexOf("Resolve-TaskRuntimeOrThrow") >= 0 && prove.indexOf("Resolve-TaskRuntimeOrThrow") < kill);
  assert.ok(prove.indexOf("Read-OnlyVerifiedRunnerOrThrow") >= 0 && prove.indexOf("Read-OnlyVerifiedRunnerOrThrow") < kill);
  assert.ok(prove.lastIndexOf("Resolve-TaskRuntimeOrThrow") > kill, "relaunch proof never revalidates the task after replacement");
  assert.ok(prove.lastIndexOf("Read-OnlyVerifiedRunnerOrThrow") > kill, "relaunch proof never revalidates the replacement process");
  assert.match(prove, /Read-RunnerIdentity \$runtime/);
  assert.match(prove, /stableLauncherVerified/);
  assert.match(prove, /processIdentityVerified/);
}

/** A stopped parent cannot leave an admitted routine-data/console child alive. */
function checkHostControlTerminatesCompleteRunnerTree(src: string): void {
  const snapshot = src.match(/function Get-ProcessTreeSnapshot \{[\s\S]*?\n\}/);
  const invoke = src.match(/function Invoke-TaskkillTree \{[\s\S]*?\n\}/);
  const stopTree = src.match(/function Stop-RunnerProcessTrees \{[\s\S]*?\n\}/);
  assert.ok(snapshot, "host control does not enumerate runner descendants before termination");
  assert.match(snapshot[0], /ParentProcessId/, "process-tree census ignores parent/child identity");
  assert.ok(invoke, "host control has no bounded native process-tree terminator");
  assert.match(invoke[0], /taskkill\.exe \/PID \$ProcessId \/T \/F/, "taskkill omits /T or /F");
  assert.ok(stopTree, "host control has no shared runner-tree stop/readback function");
  assert.match(stopTree[0], /Get-ProcessTreeSnapshot/, "runner-tree stop does not capture descendants first");
  assert.match(stopTree[0], /remainingCaptured/, "runner-tree stop never reads captured processes back");

  for (const action of ["stop", "disable", "uninstall", "prove-relaunch"]) {
    const block = actionBlock(src, action);
    assert.match(block, /Stop-RunnerProcessTrees/, `${action} can still stop only the parent runner`);
    assert.doesNotMatch(block, /Stop-Process\s+-Id/, `${action} retained a parent-only Stop-Process path`);
  }

  const disable = actionBlock(src, "disable");
  assert.ok(
    disable.indexOf('Invoke-Schtasks @("/Change", "/TN", $TaskName, "/DISABLE")') <
      disable.indexOf("Stop-RunnerProcessTrees"),
    "disable kills the process tree before closing the relaunch clock",
  );
  const uninstall = actionBlock(src, "uninstall");
  assert.ok(
    uninstall.indexOf('Invoke-Schtasks @("/Delete"') < uninstall.indexOf("Stop-RunnerProcessTrees"),
    "uninstall kills the process tree before deleting its relaunch clock",
  );
}

/** `start` cannot reactivate a task/startup entry merely because its fixed
 * name exists. It proves configuration, exact installer generation, and the
 * launched Node process identity before recording RESUME. */
function checkStartValidatesPermanentIdentity(src: string): void {
  const taskResolver = src.match(/function Resolve-TaskRuntimeOrThrow \{[\s\S]*?\n\}/);
  assert.ok(taskResolver, "start has no task-runtime identity validator");
  assert.match(taskResolver[0], /singleEntrypoint/, "a disabled/dual/incomplete task can be started");
  assert.match(taskResolver[0], /ConvertFrom-LauncherArgs/, "the task's stable-launcher arguments are not parsed");
  assert.match(taskResolver[0], /Resolve-InstalledRuntime/, "the task's clean detached runtime checkout is not validated");
  assert.match(taskResolver[0], /Test-SameResolvedPath \$Facts\.executable \$powershell/, "the task executable is not identified");
  assert.match(taskResolver[0], /Test-SameResolvedPath \$Facts\.workingDirectory \$runtime\.repoPath/, "the task working directory is not bound to the runtime");
  assert.match(taskResolver[0], /\$Facts\.arguments -ne \[string\]\$runtime\.launcherArgs/, "the task's exact launcher configuration is not compared");

  const installed = src.match(/function Resolve-InstalledRuntime \{[\s\S]*?\n\}/);
  assert.ok(installed, "installed entrypoints have no shared runtime validator");
  assert.match(installed[0], /Resolve-RuntimeConfig/, "an installed entrypoint can bypass clean detached exact-HEAD validation");
  assert.match(installed[0], /Assert-CurrentInstallerMatchesRuntimeHead/, "transition-era task code can be reactivated by the new start command");
  assert.match(installed[0], /pilot-runtime-launch\.ps1/, "the installed action is not bound to the stable launcher");

  const processIdentity = src.match(/function Test-RunnerProcessIdentity \{[\s\S]*?\n\}/);
  assert.ok(processIdentity, "start has no launched-process identity reader");
  for (const token of ["ExecutablePath", "pilot-runner.mts", "--env-file=", "--interval=", "--release-handoff"]) {
    assert.match(processIdentity[0], new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `process identity does not prove ${token}`);
  }

  const start = actionBlock(src, "start");
  assert.match(start, /Get-ScheduledTask -TaskName \$LegacyWindowTaskName[\s\S]*refusing to start while a second clock remains/, "start can run while the retired nightly-window clock remains installed");
  const resolveAt = start.indexOf("Resolve-TaskRuntimeOrThrow");
  const runAt = start.indexOf('Invoke-Schtasks @("/Run"');
  assert.ok(resolveAt >= 0 && runAt > resolveAt, "start runs Task Scheduler before validating its permanent identity");
  assert.match(start, /Resolve-StartupRuntimeOrThrow/, "the Startup fallback is not validated as the single installed entrypoint");
  assert.match(start, /explicit start configuration disagrees with the installed entrypoint/, "explicit config can compete with an installed authority");
  assert.match(start, /Wait-ForVerifiedRunnerOrThrow/, "start claims launch without reading back a matching Node process");
  assert.doesNotMatch(start, /running processes:\s*\$\(\(Get-RunnerProcesses/, "start still reports count-only success");
  const resumeAt = start.indexOf('Invoke-PauseNote -IntentAction "RESUME_RUNNER"');
  const verifiedAt = start.indexOf("Wait-ForVerifiedRunnerOrThrow");
  assert.ok(resumeAt > verifiedAt, "a refused start can write RESUME before a permanent process is proven");
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

test("install keeps the Startup launcher fallback-only and removes it for a live task", () => {
  checkInstallKeepsOneEntrypoint(scriptText());
});

test("install validates an explicit clean detached checkout, absolute environment path, and deployed SHA before registration", () => {
  checkInstallValidatesRuntimeBoundary(scriptText());
  checkStableLauncher(readFileSync(LAUNCHER, "utf8").replace(/\r\n/g, "\n"));
});

test("start validates the single permanent entrypoint and reads back exact process identity", () => {
  checkStartValidatesPermanentIdentity(scriptText());
});

test("status derives relaunch-trigger presence from the live task, not a constant", () => {
  checkStatusDerivesPresenceFromLiveTask(scriptText());
});

test("verify-triggers exits on the derived presence and prove-relaunch writes the typed record", () => {
  const src = scriptText();
  const verify = actionBlock(src, "verify-triggers");
  assert.match(verify, /verdict\s*=\s*"VERIFIED"/);
  assert.match(verify, /verdict\s*=\s*"REFUSED"/);
  assert.match(verify, /exit 0/);
  assert.match(verify, /exit 1/);
  const prove = actionBlock(src, "prove-relaunch");
  for (const key of [
    "measuredAt",
    "killedPid",
    "relaunchedPid",
    "secondsToRelaunch",
    "runtimeSha",
    "stableLauncherVerified",
    "processIdentityVerified",
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

test("status, trigger verification and relaunch proof bind to the exact installed runtime and process", () => {
  checkHostControlProvesExactRuntime(scriptText());
});

test("stop, disable, uninstall, and relaunch proof terminate and read back the full runner process tree", () => {
  checkHostControlTerminatesCompleteRunnerTree(scriptText());
});

test("POSITIVE CONTROL: parent-only termination fails the process-tree checker", () => {
  const src = scriptText();
  const noTreeFlag = src.replace("taskkill.exe /PID $ProcessId /T /F", "taskkill.exe /PID $ProcessId /F");
  assert.notEqual(noTreeFlag, src);
  assert.ok(
    fails(() => checkHostControlTerminatesCompleteRunnerTree(noTreeFlag)),
    "taskkill without /T passed the process-tree checker",
  );

  const parentOnlyDisable = src.replaceAll("Stop-RunnerProcessTrees", "Stop-RunnerParentOnly");
  assert.notEqual(parentOnlyDisable, src);
  assert.ok(
    fails(() => checkHostControlTerminatesCompleteRunnerTree(parentOnlyDisable)),
    "disable without process-tree termination passed the checker",
  );
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
    /if \(-not \$facts\.singleEntrypoint\) \{[\s\S]*?exit 2\s*\n\s*\}/,
    "",
  );
  assert.notEqual(unguarded, src);
  assert.ok(fails(() => checkProveRelaunchRefusesWithoutTrigger(unguarded)), "a prove-relaunch that kills without checking passed");
});

test("POSITIVE CONTROL: an unconditional Startup launcher fails the single-entrypoint checker", () => {
  const src = scriptText();
  const unconditional = src.replace(
    /if \(\$taskLanded\) \{[\s\S]*?Remove-StartupEntryOrThrow[\s\S]*?\}\s*else \{\s*\$file = Install-StartupEntry -PowerShell \$powershell -LauncherArgs \$launcherArgs\s*\}/,
    "$file = Install-StartupEntry -PowerShell $powershell -LauncherArgs $launcherArgs",
  );
  assert.notEqual(unconditional, src, "the mutation did not apply; the test would prove nothing");
  assert.ok(fails(() => checkInstallKeepsOneEntrypoint(unconditional)), "an unconditional Startup writer passed");
});

test("POSITIVE CONTROL: a name-only task start or count-only process check fails the permanent-identity checker", () => {
  const src = scriptText();
  const nameOnly = src.replace("$runtime = Resolve-TaskRuntimeOrThrow $facts", "$runtime = $facts");
  assert.notEqual(nameOnly, src);
  assert.ok(fails(() => checkStartValidatesPermanentIdentity(nameOnly)), "a task trusted only by fixed name passed");

  const countOnly = src.replace(
    "$verified = Wait-ForVerifiedRunnerOrThrow -Runtime $runtime",
    "$verified = @(Get-RunnerProcesses)[0]",
  );
  assert.notEqual(countOnly, src);
  assert.ok(fails(() => checkStartValidatesPermanentIdentity(countOnly)), "a count-only launch readback passed");

  const staleInstallerAccepted = src.replace(
    "Assert-CurrentInstallerMatchesRuntimeHead -RuntimeRepo $resolved.repoPath -RuntimeHead $resolved.expectedSha",
    "# stale installer accepted",
  );
  assert.notEqual(staleInstallerAccepted, src);
  assert.ok(
    fails(() => checkStartValidatesPermanentIdentity(staleInstallerAccepted)),
    "a transition-era installed task passed without matching the permanent installer generation",
  );

  const prematureResume = src.replace(
    '$verified = Wait-ForVerifiedRunnerOrThrow -Runtime $runtime',
    'Invoke-PauseNote -IntentAction "RESUME_RUNNER" -Note "unproven" -By "test"\n            $verified = Wait-ForVerifiedRunnerOrThrow -Runtime $runtime',
  );
  assert.notEqual(prematureResume, src);
  assert.ok(fails(() => checkStartValidatesPermanentIdentity(prematureResume)), "a RESUME written before launch identity passed");

  const startAt = src.indexOf('    "start" {');
  const dualClock = src.slice(0, startAt) + src.slice(startAt).replace(
    /if \(Get-ScheduledTask -TaskName \$LegacyWindowTaskName -ErrorAction SilentlyContinue\) \{[\s\S]*?\n\s*\}/,
    "",
  );
  assert.notEqual(dualClock, src);
  assert.ok(fails(() => checkStartValidatesPermanentIdentity(dualClock)), "start passed while blind to the retired second clock");
});

test("POSITIVE CONTROL: name/count-only host control fails the exact-runtime checker", () => {
  const src = scriptText();
  const nameOnly = src.replaceAll("$runtime = Resolve-TaskRuntimeOrThrow $facts", "$runtime = $facts");
  assert.notEqual(nameOnly, src);
  assert.ok(fails(() => checkHostControlProvesExactRuntime(nameOnly)));

  const countOnly = src.replaceAll(
    "$verified = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtime -Required $true",
    "$verified = @(Get-RunnerProcesses)[0]",
  );
  assert.notEqual(countOnly, src);
  assert.ok(fails(() => checkHostControlProvesExactRuntime(countOnly)));

  const noFinalReadback = src.replace(
    "$finalIdentity = Read-OnlyVerifiedRunnerOrThrow -Runtime $runtimeAfter -Required $true",
    "$finalIdentity = $freshMatching[0]",
  );
  assert.notEqual(noFinalReadback, src);
  assert.ok(fails(() => checkHostControlProvesExactRuntime(noFinalReadback)));
});

/* ===========================================================================
 * PDC V2 — ONE INSTALLED CLOCK, AND CLEANUP OF THE RETIRED SECOND ONE.
 *
 * The standing runner performs the nightly research due-check on its own
 * internal clock. The former `install-window` action registered a second daily
 * Task Scheduler clock for the same operation. New code must not be able to
 * create it, while install and uninstall must remove its fixed legacy task.
 * ======================================================================= */

function checkNoInstallableWindowClock(src: string, packageText: string): void {
  assert.doesNotMatch(src, /"install-window"\s*\{/, "the retired second-clock action remains executable");
  assert.doesNotMatch(src, /ValidateSet\([^)]*"install-window"/, "the retired action remains accepted by the CLI");
  assert.doesNotMatch(src, /function Get-Window(?:Args|LocalTimes)/, "the retired window-task constructor remains callable");
  assert.doesNotMatch(src, /New-ScheduledTaskTrigger -Daily/, "the installer can still create a daily second clock");
  assert.doesNotMatch(packageText, /"pilot:install-window"\s*:/, "package.json still exposes the retired clock");
}

function checkLegacyWindowClockCleanup(src: string): void {
  assert.match(src, /^\$LegacyWindowTaskName\s*=\s*"WeThePeople Nightly Window"/m, "the old fixed task name is not retained for cleanup");
  const cleanup = src.match(/function Remove-LegacyWindowTaskOrThrow \{[\s\S]*?\n\}/);
  assert.ok(cleanup, "install has no fail-closed legacy-clock cleanup helper");
  assert.match(cleanup[0], /Invoke-Schtasks @\("\/Delete", "\/TN", \$LegacyWindowTaskName, "\/F"\)/, "legacy cleanup does not delete the old fixed task");
  assert.match(cleanup[0], /Get-ScheduledTask -TaskName \$LegacyWindowTaskName/, "legacy cleanup does not read back absence");
  assert.match(actionBlock(src, "install"), /Remove-LegacyWindowTaskOrThrow/, "installation can admit the runner before deleting the old clock");

  const uninstall = actionBlock(src, "uninstall");
  assert.match(uninstall, /foreach \(\$name in @\(\$TaskName, \$LegacyWindowTaskName\)\)/, "uninstall does not cover both task identities");
  assert.match(uninstall, /Invoke-Schtasks @\("\/Delete", "\/TN", \$name, "\/F"\)/, "uninstall does not delete both task identities");
  assert.match(uninstall, /Get-ScheduledTask -TaskName \$name/, "uninstall does not read back that both task identities are absent");
  assert.match(uninstall, /UNINSTALL INCOMPLETE[\s\S]*exit 1/, "uninstall can claim success with a task still present");
}

test("the standing runner has no installable nightly-window backup clock and install/uninstall retire the old task", () => {
  const src = scriptText();
  checkNoInstallableWindowClock(src, readFileSync(PACKAGE, "utf8"));
  checkLegacyWindowClockCleanup(src);
});

test("POSITIVE CONTROL: a restored second-clock action or incomplete uninstall fails the PDC checker", () => {
  const src = scriptText();
  const restored = src.replace(
    '[ValidateSet("validate-config", "install", "start", "stop", "status", "disable", "uninstall", "verify-triggers", "prove-relaunch", "owner-command")]',
    '[ValidateSet("validate-config", "install", "start", "stop", "status", "disable", "uninstall", "verify-triggers", "prove-relaunch", "owner-command", "install-window")]',
  );
  assert.notEqual(restored, src);
  assert.ok(fails(() => checkNoInstallableWindowClock(restored, readFileSync(PACKAGE, "utf8"))), "a restored install-window action passed");

  const incomplete = src.replaceAll("foreach ($name in @($TaskName, $LegacyWindowTaskName))", "foreach ($name in @($TaskName))");
  assert.notEqual(incomplete, src);
  assert.ok(fails(() => checkLegacyWindowClockCleanup(incomplete)), "an uninstall that leaves the legacy clock passed");
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
  const rederive = block.lastIndexOf("Get-TaskFacts");
  assert.ok(rederive >= 0, "disable never re-derives the live task with Get-TaskFacts");
  const disableCall = block.indexOf('Invoke-Schtasks @("/Change"');
  assert.ok(disableCall >= 0, "disable never invokes the task disable operation");
  assert.ok(
    rederive > disableCall,
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
