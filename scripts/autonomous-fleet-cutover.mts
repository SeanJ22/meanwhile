import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { acquireWindowLease, releaseWindowLease, WINDOW_LEASE_ID } from "../lib/control-plane/promotion/window.ts";

const root = resolve(import.meta.dirname, "..");
const connection = controlPlaneUrlFromEnv(); if (!connection) throw new Error("CUTOVER_CONTROL_PLANE_NOT_CONFIGURED");
const repos = await createPgRepositories(connection);
const now = new Date().toISOString();
const holder = `autonomous-fleet-cutover:${process.pid}`;
const before = await repos.leases.read(WINDOW_LEASE_ID);
const dir = join(root, "data/health/autonomous-agent-fleet/cutover"); mkdirSync(dir, { recursive: true });
const recover = process.argv.find(a => a.startsWith("--recover-dead-holder="))?.slice(22);
if (recover) {
  const parsed = /^cycle@([^#]+)#(\d+)$/.exec(recover);
  if (!parsed || parsed[1].toLowerCase() !== process.env.COMPUTERNAME?.toLowerCase() || before?.value.holder !== recover) throw new Error("CUTOVER_RECOVERY_EXACT_LOCAL_HOLDER_REQUIRED");
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command", `if (Get-Process -Id ${Number(parsed[2])} -ErrorAction SilentlyContinue) { exit 3 } else { exit 0 }`], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) throw new Error("CUTOVER_RECOVERY_PROCESS_LIVE_OR_UNKNOWN");
  const released = await releaseWindowLease(repos, recover, now);
  writeFileSync(join(dir, "dead-cycle-recovery.json"), JSON.stringify({ observedAt: now, holder: recover, exactLocalPid: Number(parsed[2]), processProbeExit: probe.status,
    releasedThrough: "releaseWindowLease", released, reason: "The stopped old runner's exact cycle PID is absent; the old lease is recovered without falsifying clock or expiry." }, null, 2) + "\n");
}
try {
  const acquired = await acquireWindowLease(repos, holder, now, 2 * 60 * 60_000);
  const proof = { observedAt: now, holder, before: before?.value ?? null, acquired, reason: "Temporary serialization of the old three-role standing runner during authorized additive fleet integration. Promotion OFF. Parent releases exact holder after merged code." };
  writeFileSync(join(dir, "maintenance-lease.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
} catch (error) {
  const proof = { observedAt: now, holder, before: before?.value ?? null, refused: error instanceof Error ? error.message : "CUTOVER_LEASE_REFUSED" };
  writeFileSync(join(dir, "maintenance-lease-refused.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof)); process.exitCode = 1;
}
