/** Summarize existing measurements locally; this script never opens a production connection. */
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(option("root") ?? ".scratch/rh01"), output = resolve(option("output") ?? "docs/rh01-production-read-accounting.json");
const cutoff = "2026-10-20T07:02:40.000Z";
const parts = new Map<string, { reader: number; control: number }>();
const subsequentNative = new Map<string, { reader: number; control: number }>();
let historicalLogs = 0, malformedReports = 0;
async function visit(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!/^(?:facts|vault|prl-archive|aggregates|logs|base|global|pg_.+)$/.test(entry.name)) await visit(path);
      continue;
    }
    if (!/\.(?:log|jsonl)$/.test(entry.name) || entry.name === "production-read-bytes.jsonl") continue;
    historicalLogs++;
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
      if (!line.startsWith("vital-signs-bytes ")) continue;
      try {
        const row = JSON.parse(line.slice(18));
        if (!Number.isInteger(row.pid) || !Number.isFinite(row.startedMs)) continue;
        if (row.startedMs >= Date.parse(cutoff)) {
          const key = `${row.pid}/${row.hour}`, prior = subsequentNative.get(key);
          subsequentNative.set(key, { reader: Math.max(prior?.reader ?? 0, row.bytes?.reader ?? 0),
            control: Math.max(prior?.control ?? 0, row.bytes?.["control-plane"] ?? 0) });
          continue;
        }
        const key = `${row.pid}/${row.startedMs}/${row.hour}`, prior = parts.get(key);
        parts.set(key, { reader: Math.max(prior?.reader ?? 0, row.bytes?.reader ?? 0),
          control: Math.max(prior?.control ?? 0, row.bytes?.["control-plane"] ?? 0) });
      } catch { malformedReports++; }
    }
  }
}
await visit(root);
const historicalReaderBytes = [...parts.values()].reduce((sum, row) => sum + row.reader, 0);
const historicalControlBytes = [...parts.values()].reduce((sum, row) => sum + row.control, 0);
const ledger = join(root, "production-read-bytes.jsonl");
let subsequentReaderBytes = 0, subsequentControlBytes = 0, subsequentChunks = 0;
const streamed = new Map<string, { reader: number; control: number }>();
try {
  for await (const line of createInterface({ input: createReadStream(ledger), crlfDelay: Infinity })) {
    const row = JSON.parse(line); subsequentChunks++;
    const key = `${row.pid}/${new Date(Math.floor(Date.parse(row.at) / 3_600_000) * 3_600_000).toISOString()}`;
    const part = streamed.get(key) ?? { reader: 0, control: 0 };
    if (row.database === "reader") part.reader += row.bytes;
    else if (row.database === "control-plane") part.control += row.bytes;
    streamed.set(key, part);
  }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
for (const key of new Set([...streamed.keys(), ...subsequentNative.keys()])) {
  subsequentReaderBytes += Math.max(streamed.get(key)?.reader ?? 0, subsequentNative.get(key)?.reader ?? 0);
  subsequentControlBytes += Math.max(streamed.get(key)?.control ?? 0, subsequentNative.get(key)?.control ?? 0);
}
const knownReaderResponseBytes = historicalReaderBytes + subsequentReaderBytes;
const knownControlResponseBytes = historicalControlBytes + subsequentControlBytes;
const report = { generatedAt: new Date().toISOString(), historicalCutoff: cutoff,
  knownReaderResponseBytes, knownControlResponseBytes, knownProductionResponseBytes: knownReaderResponseBytes + knownControlResponseBytes,
  knownReaderDecimalGB: knownReaderResponseBytes / 1e9,
  incrementalChargeAt010USDPerGB: knownReaderResponseBytes / 1e10,
  historicalReaderBytes, historicalControlBytes, historicalProcessHours: parts.size, historicalLogs, malformedReports,
  subsequentReaderBytes, subsequentControlBytes, subsequentChunks, subsequentNativeProcessHours: subsequentNative.size,
  exactTaskTotalAvailable: false,
  limits: ["Historical per-process/hour HTTP body counters are deduplicated across all retained logs by PID, process start and hour, taking each cumulative maximum once.",
    "The streaming measurement log counts actual subsequent reader/control HTTP body chunks and WebSocket message payloads. Local/cache responses are excluded. Native counters recover a one-place preparation made before the regional HTTP endpoint accounting correction. For each later PID/hour, the larger native or streaming total is counted once, never their sum.",
    "Earlier preparation queries, unreported interrupted reads and historical temporary-database hydration are not fully counted. The task's exact total is unknown; the reported sum is a known minimum of observed response-body bytes, not a complete billing total.",
    "Per-job logical bytes and cached replay bytes are separate workload measurements and must not be added to this actual-production sum."] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, knownReaderResponseBytes, historicalProcessHours: parts.size, exactTaskTotalAvailable: false }));
