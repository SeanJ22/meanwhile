/** The local PostgreSQL stand-in is remote infrastructure in production, outside runner admission. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function processStartTicks(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const ticks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  if (!ticks || !/^\d+$/.test(ticks)) throw Error("RH01_REMOTE_PROCESS_BIRTH_UNREADABLE");
  return ticks;
}

export function runnerProcessRows<T extends { readonly pid: number; readonly parentPid: number }>(rows: readonly T[]): readonly T[] {
  const saved = process.env.WTP_RH01_REMOTE_DATABASE_PROCESS;
  if (!saved) return rows;
  const descriptor = JSON.parse(saved) as { pid?: unknown; startTicks?: unknown };
  if (!Number.isSafeInteger(descriptor.pid) || Number(descriptor.pid) <= 0 || descriptor.pid === process.pid ||
    typeof descriptor.startTicks !== "string" || !/^\d+$/.test(descriptor.startTicks)) throw Error("RH01_REMOTE_PROCESS_IDENTITY_INVALID");
  const pid = Number(descriptor.pid);
  const expected = join(process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd(), "scripts/rh01-facts-server.mts");
  if (processStartTicks(pid) !== descriptor.startTicks || !readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").includes(expected))
    throw Error("RH01_REMOTE_PROCESS_IDENTITY_CHANGED");
  const excluded = new Set([pid]);
  for (;;) {
    let changed = false;
    for (const row of rows) if (excluded.has(row.parentPid) && !excluded.has(row.pid)) { excluded.add(row.pid); changed = true; }
    if (!changed) break;
  }
  return rows.filter(row => !excluded.has(row.pid));
}
