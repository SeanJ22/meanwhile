/** Compact exact-offer evidence, including explicitly unmeasured inventory rows. */
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

interface Job {
  id: string; script: string; command: readonly string[]; scope?: string; recordClass?: string;
  ownPeakRssBytes?: number; peakRssBytes?: number; readerBytes?: number; controlPlaneBytes?: number; elapsedMs?: number;
  complete?: boolean; successful?: boolean; completionReason?: string; error?: string; code?: number | null;
  sourceReceipt?: { state?: string; decision?: string; acquisitionSucceeded?: boolean } | null;
}
interface Run { phase: string; codeRevision?: string; codeRoot: string; startedAt: string; jobs?: readonly Job[]; results?: readonly Job[] }
const options = (name: string) => process.argv.filter(value => value.startsWith(`--${name}=`)).map(value => value.slice(name.length + 3));
const output = resolve(options("output")[0] ?? "docs/rh01-job-measurements.csv");
const columns = ["run", "phase", "code_label", "code_sha", "started_at_utc", "job_id", "script", "command_json", "scope", "record_class", "status", "source_result",
  "own_peak_rss_bytes", "owned_tree_peak_rss_bytes", "reader_bytes", "control_plane_bytes", "elapsed_ms", "exit_code", "completion_reason"];
const rows: (string | number | boolean | null | undefined)[][] = [columns];
for (const path of options("run")) {
  const run = JSON.parse(await readFile(resolve(path), "utf8")) as Run;
  const diagnostic = run.codeRoot === process.cwd();
  for (const job of run.jobs ?? run.results ?? []) rows.push([
    basename(dirname(path)), run.phase, diagnostic ? "mutable-working-tree-diagnostic" : "immutable-archive", run.codeRevision,
    run.startedAt, job.id, job.script, JSON.stringify(job.command), job.scope, job.recordClass,
    job.complete ? job.successful === false ? "COMPLETE_HELD" : "COMPLETE" : "INCOMPLETE_LOWER_BOUND",
    job.sourceReceipt?.state ?? job.sourceReceipt?.decision,
    job.ownPeakRssBytes, job.peakRssBytes, job.readerBytes, job.controlPlaneBytes, job.elapsedMs, job.code,
    job.completionReason ?? job.error,
  ]);
}
for (const path of options("inventory")) {
  const inventory = JSON.parse(await readFile(resolve(path), "utf8")) as { phase?: string; jobs: readonly Job[] };
  for (const job of inventory.jobs) rows.push([
    basename(dirname(path)), inventory.phase ?? "after", "final-frozen-workload-outstanding", "", "", job.id, job.script,
    JSON.stringify(job.command), job.scope, job.recordClass, "UNMEASURED_FINAL_OFFER", "", "", "", "", "", "", "",
    "Required final exact-offer measurement remains outstanding; diagnostic rows do not substitute.",
  ]);
}
if (rows.length === 1) throw Error("RH01 export requires at least one --run or --inventory");
const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
await writeFile(output, csv);
console.log(JSON.stringify({ output, rows: rows.length - 1 }));
