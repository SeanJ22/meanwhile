#!/usr/bin/env node
/**
 * Non-writing front door from an engineering checkout to the installed
 * permanent runtime. The PowerShell authority resolves and validates the live
 * Scheduled Task configuration; this process never opens a database itself.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODES = new Set(["manual-promote", "window", "agent-bridge-job", "agent-bridge-review", "routine-refresh"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, ...args] = process.argv.slice(2);
if (!mode || !MODES.has(mode)) {
  process.stderr.write(`INSTALLED_RUNTIME_COMMAND_REFUSED: mode must be one of ${[...MODES].join(", ")}\n`);
  process.exit(2);
}
if (args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))) {
  process.stderr.write("INSTALLED_RUNTIME_COMMAND_REFUSED: arguments may not contain control-line bytes\n");
  process.exit(2);
}

const payload = Buffer.from(JSON.stringify({ mode, args }), "utf8").toString("base64");
const powershell = process.platform === "win32"
  ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : "pwsh";
const result = spawnSync(powershell, [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy", "Bypass",
  "-File", join(root, "scripts", "pilot-task.ps1"),
  "-Action", "owner-command",
  "-OwnerCommandPayload", payload,
], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  process.stderr.write(`INSTALLED_RUNTIME_COMMAND_REFUSED: ${result.error.name}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
