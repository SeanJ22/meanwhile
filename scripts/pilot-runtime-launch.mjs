#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { validateRuntimeConfig } from "./pilot-runtime-config.mjs";

const root = resolve(process.env.WTP_RUNTIME_REPO ?? process.cwd());
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
  `--env-file=${envFile}`, "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
  "scripts/pilot-runner.mts", ...(staging ? ["--staging"] : ["--release-handoff"]), ...process.argv.slice(2),
], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, WTP_BILLING_ENV_FILE: envFile, ...(staging ? { WTP_RUNTIME_MODE: "staging" } : {
    WTP_RUNTIME_AUTHORITY_REPO: root, WTP_RUNTIME_AUTHORITY_SHA: sha,
    WTP_RUNTIME_AUTHORITY_CAPABILITY: "STANDING_PARENT",
    WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.pid), WTP_RUNTIME_AUTHORITY_NONCE: randomBytes(32).toString("hex") }) },
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { process.stderr.write(`Runtime launch failed (${error.name})\n`); process.exitCode = 2; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 2); });
