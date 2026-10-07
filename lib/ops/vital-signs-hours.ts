/** The standing runner's per-process hour files for vital signs, so a parent restart mid-hour keeps what was already reported. */
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hourStart, type NeonBytesHour, type NeonDatabase } from "../db/transfer-by-caller.ts";

/** Keep one process's latest part for its hour (each part is that process's whole hour so far). */
export function keepNeonBytesPart(dir: string, part: NeonBytesHour): boolean {
  if (!Number.isSafeInteger(part.pid) || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(part.hour)) return false;
  try {
    mkdirSync(dir, { recursive: true });
    /* The start time keeps a reused pid from overwriting another process's hour. */
    const started = Number.isSafeInteger(part.startedMs) ? `-${part.startedMs}` : "";
    const file = join(dir, `${part.hour.slice(0, 13)}--${part.pid}${started}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(part), "utf8");
    renameSync(`${file}.tmp`, file);
    return true;
  } catch { return false; }
}

/** Sum every process's file for one hour. Unreadable files are skipped, not fatal. */
export function readNeonBytesHour(dir: string, hour: string): NeonBytesHour {
  const sum = { requests: 0, bytes: { reader: 0, "control-plane": 0 } as Record<NeonDatabase, number>,
    byCaller: {} as Record<string, number>, processes: [] as string[], counters: {} as Record<string, number> };
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* no runner files yet */ }
  const prefix = `${hour.slice(0, 13)}--`;
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    try {
      const part = JSON.parse(readFileSync(join(dir, name), "utf8")) as NeonBytesHour;
      if (part.hour !== hour) continue;
      sum.requests += part.requests;
      sum.bytes.reader += part.bytes.reader ?? 0;
      sum.bytes["control-plane"] += part.bytes["control-plane"] ?? 0;
      for (const [caller, bytes] of Object.entries(part.byCaller)) sum.byCaller[caller] = (sum.byCaller[caller] ?? 0) + bytes;
      sum.processes.push(...part.processes);
      for (const [counter, count] of Object.entries(part.counters ?? {})) sum.counters[counter] = (sum.counters[counter] ?? 0) + count;
    } catch { /* a half-written or foreign file */ }
  }
  return { hour, ...sum };
}

/** Delete hour files older than `keepMs` (default two days). */
export function pruneNeonBytes(dir: string, nowMs: number = Date.now(), keepMs = 48 * 3_600_000): void {
  const oldest = hourStart(nowMs - keepMs).slice(0, 13);
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.slice(0, 13) < oldest) { try { unlinkSync(join(dir, name)); } catch { /* already gone */ } }
  }
}
