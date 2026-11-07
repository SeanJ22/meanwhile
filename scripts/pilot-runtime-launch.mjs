#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { clearStaleGitLocks, settleSwitch, switchHasBeat } from "../lib/ops/runtime-release-guard.ts";

const root = resolve(process.env.WTP_RUNTIME_REPO ?? process.cwd());
// First, before any other code of this checkout loads: a stale git lock would fail every start, and a release that
// never sent a heartbeat is replaced by the copy it came from (systemd starts this launcher again after the exit).
clearStaleGitLocks(root);
const settled = settleSwitch(root);
if (settled.state === "rolledBack" || settled.state === "rollbackFailed") process.exit(1);
const { storedKeyEnvironment } = await import("../lib/core/keys-values.ts");
const { validateRuntimeConfig } = await import("./pilot-runtime-config.mjs");
const envFile = resolve(root, ".env.local");
const staging = process.env.WTP_RUNTIME_MODE !== "production";
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!staging) validateRuntimeConfig({ repoPath: root, envFile, expectedSha: sha });
// Only an admitted checkout may recover installation state.
const { resumeRuntimeReleaseInstall } = await import("../lib/ops/runtime-release-handoff.ts");
const recoveredInstall = resumeRuntimeReleaseInstall({ root });
if (recoveredInstall?.state === "REFUSED") {
  process.stderr.write(`Runtime install recovery failed: ${recoveredInstall.code}\n`);
  process.exit(2);
}
const child = spawn(process.execPath, [
  ...(staging ? [`--env-file=${envFile}`] : []), "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
  "scripts/pilot-runner.mts", ...(staging ? ["--staging"] : ["--release-handoff"]), ...process.argv.slice(2),
], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...storedKeyEnvironment(), ...(staging ? { WTP_RUNTIME_MODE: "staging" } : {
    WTP_RUNTIME_AUTHORITY_REPO: root, WTP_RUNTIME_AUTHORITY_SHA: sha,
    WTP_RUNTIME_AUTHORITY_CAPABILITY: "STANDING_PARENT",
    WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.pid), WTP_RUNTIME_AUTHORITY_NONCE: randomBytes(32).toString("hex") }) },
});
// A release that hangs before its first beat never exits, so the launcher ends it when the five minutes pass.
let hung = false;
const beatWatch = settled.state === "pending" ? setTimeout(() => {
  if (switchHasBeat(root)) return;
  hung = true; child.kill("SIGKILL");
}, settled.dueInMs + 1_000) : null;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { process.stderr.write(`Runtime launch failed (${error.name})\n`); process.exitCode = 2; });
child.on("exit", (code, signal) => { clearTimeout(beatWatch); process.exitCode = hung ? 1 : code ?? (signal ? 1 : 2); });
