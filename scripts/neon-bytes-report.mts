/**
 * Neon bytes by calling code, bytes per hour, and each runner process's peak memory against the 0.75 GiB
 * margin, summed from the runner's hour files (every runner process writes its part; transfer-by-caller.ts).
 *
 *   node --experimental-strip-types scripts/neon-bytes-report.mts [--dir=.runtime/vital-signs] [--since=<ISO>] [--top=25]
 *
 * `--since` keeps the processes that started at or after it, so one staged cycle is read on its own.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NeonBytesHour } from "../lib/db/transfer-by-caller.ts";

const MARGIN_BYTES = 0.75 * 1024 ** 3;
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg("dir") ?? join(process.cwd(), ".runtime", "vital-signs");
const since = arg("since") ? Date.parse(arg("since")!) : Number.NEGATIVE_INFINITY;
const top = Number(arg("top") ?? 25);
if (Number.isNaN(since)) throw new Error("--since must be an ISO instant");

const byCaller = new Map<string, number>();
const processes = new Map<string, { peak: number; bytes: number }>();
const bytes = { "control-plane": 0, reader: 0 };
let requests = 0, first = Number.POSITIVE_INFINITY, last = Number.NEGATIVE_INFINITY;
for (const name of readdirSync(dir).filter(file => file.endsWith(".json"))) {
  let part: NeonBytesHour;
  try { part = JSON.parse(readFileSync(join(dir, name), "utf8")) as NeonBytesHour; } catch { continue; }
  if (!Number.isFinite(part.startedMs) || part.startedMs! < since) continue;
  first = Math.min(first, part.startedMs!);
  last = Math.max(last, statSync(join(dir, name)).mtimeMs);
  requests += part.requests;
  bytes["control-plane"] += part.bytes["control-plane"] ?? 0;
  bytes.reader += part.bytes.reader ?? 0;
  for (const [caller, count] of Object.entries(part.byCaller)) byCaller.set(caller, (byCaller.get(caller) ?? 0) + count);
  const label = part.processes[0] ?? `pid ${part.pid}`;
  const held = processes.get(label) ?? { peak: 0, bytes: 0 };
  processes.set(label, { peak: Math.max(held.peak, part.peakRssBytes ?? 0),
    bytes: held.bytes + (part.bytes["control-plane"] ?? 0) + (part.bytes.reader ?? 0) });
}

const mb = (count: number) => `${(count / 1e6).toFixed(1)} MB`;
const hours = Math.max((last - first) / 3_600_000, 1 / 60);
const total = bytes["control-plane"] + bytes.reader;
console.log(`window ${Number.isFinite(first) ? new Date(first).toISOString() : "none"} to ${Number.isFinite(last) ? new Date(last).toISOString() : "none"} ` +
  `(${(hours * 60).toFixed(0)} min, ${processes.size} processes, ${requests} requests)`);
console.log(`Neon bytes: control plane ${mb(bytes["control-plane"])}, reader ${mb(bytes.reader)}, total ${mb(total)}; ` +
  `${mb(total / hours)} per hour at this rate`);
console.log("\nby caller:");
for (const [caller, count] of [...byCaller].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)) {
  console.log(`  ${mb(count).padStart(10)}  ${caller}`);
}
console.log(`\nprocesses (peak resident memory against the ${(MARGIN_BYTES / 1024 ** 3).toFixed(2)} GiB margin):`);
for (const [label, held] of [...processes].sort((a, b) => b[1].peak - a[1].peak)) {
  const gib = held.peak / 1024 ** 3;
  console.log(`  ${held.peak ? `${gib.toFixed(2)} GiB`.padStart(10) : "unmeasured".padStart(10)}  ${held.peak > MARGIN_BYTES ? "OVER " : ""}${label}  (${mb(held.bytes)})`);
}
