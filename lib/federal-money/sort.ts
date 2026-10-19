import { temporaryPath } from "../civic-data/temporary-path.ts";
import { createHash } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { createReadStream } from "node:fs";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseFederalMoneyRow } from "./parse.ts";
import { parseCsv } from "../reference/csv.ts";
import { federalMoneyPartitionOf } from "./model.ts";
import { federalCsvRecords } from "./streams.ts";
import { sortSourceRecords } from "../reference/external-sort.ts";
import type { FederalMoneyCapture, FederalMoneySource } from "./model.ts";
const memory = channel("federal-money:memory");

function key(source: FederalMoneySource, state: string, capture: FederalMoneyCapture, row: string, header: readonly string[]): string {
  let value: Record<string, unknown>;
  if (capture.format === "csv") { value = {}; const fields = parseCsv(row)[0]!; for (let index = 0; index < header.length; index++) value[header[index]!] = fields[index] ?? ""; }
  else value = JSON.parse(row) as Record<string, unknown>;
  const fact = parseFederalMoneyRow(source, capture, state, value);
  const partition = federalMoneyPartitionOf(fact);
  return `${partition.year}\x1f${partition.place}\x1f${createHash("sha256").update(fact.id).digest("hex")}`;
}
async function sortFile(input: string, output: string, signal?: AbortSignal): Promise<void> {
  if (memory.hasSubscribers) memory.publish({ stage: "external-sort", item: input, itemBytes: (await stat(input)).size, liveItems: 1, bufferBytes: 16 * 1024 * 1024 });
  await sortSourceRecords(input, output, signal);
}
export async function sortFederalSourceFile(input: { source: FederalMoneySource; state: string; path: string; metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">; signal?: AbortSignal }): Promise<string> {
  const output = `${input.path}.ordered`, keyed = `${input.path}.keys`, sorted = `${keyed}.sorted`, checkpoint = `${keyed}.state`;
  try { if ((await stat(output)).isFile()) return output; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let progress = { offset: 0, outputOffset: 0, header: "", complete: false };
  try { progress = JSON.parse(await readFile(checkpoint, "utf8")) as typeof progress; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!progress.complete) {
    const file = await open(temporaryPath(keyed), progress.outputOffset ? "r+" : "w"); await file.truncate(progress.outputOffset); let rows = 0, largestRow = 0;
    let header = progress.header ? parseCsv(progress.header.replace(/^\uFEFF/, ""))[0]! : [];
    const capture = { ...input.metadata, rawHash: "0".repeat(64), vaultKey: "", byteLength: 0 };
    const save = async (complete = false) => { progress.complete = complete; await writeFile(temporaryPath(`${checkpoint}.next`), JSON.stringify(progress)); await rename(temporaryPath(`${checkpoint}.next`), temporaryPath(checkpoint)); rows = 0; };
    const write = async (row: string) => { const rowBytes = Buffer.byteLength(row); if (memory.hasSubscribers && (rows === 0 || rowBytes > largestRow)) memory.publish({ stage: "sort-key", item: input.path, itemBytes: rowBytes, liveItems: 1 }); largestRow = Math.max(largestRow, rowBytes); const bytes = Buffer.from(`${key(input.source, input.state, capture, row, header)}\t${Buffer.from(row).toString("base64")}\n`); await file.write(bytes, 0, bytes.length, progress.outputOffset); progress.outputOffset += bytes.length; rows++; if (rows >= 500) await save(); };
    try {
      if (input.metadata.format === "csv") {
        for await (const row of federalCsvRecords(createReadStream(input.path, { start: progress.offset }))) {
          input.signal?.throwIfAborted(); progress.offset += Buffer.byteLength(row);
          if (!progress.header) { progress.header = row; header = parseCsv(row.replace(/^\uFEFF/, ""))[0]!; if (!header || header.length < 2) throw new Error("The source sort CSV header is invalid."); continue; } if (row.trim()) await write(row);
        }
      } else {
        const source = await open(input.path, "r");
        try {
          for (;;) { input.signal?.throwIfAborted(); const header = Buffer.alloc(4), next = await source.read(header, 0, 4, progress.offset); if (!next.bytesRead) break;
            if (next.bytesRead !== 4 || header.readUInt32LE() > 8 * 1024 * 1024) throw new Error("The JSON sort spool is invalid.");
            const bytes = Buffer.alloc(header.readUInt32LE()), body = await source.read(bytes, 0, bytes.length, progress.offset + 4); if (body.bytesRead !== bytes.length) throw new Error("The JSON sort spool is truncated.");
            progress.offset += bytes.length + 4; await write(bytes.toString("utf8"));
          }
        } finally { await source.close(); }
      }
      await save(true);
    } finally { await file.close(); }
  }
  try { await stat(`${sorted}.ready`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await sortFile(keyed, sorted, input.signal); await writeFile(temporaryPath(`${sorted}.ready`), "1"); }
  await rm(temporaryPath(keyed), { force: true });
  const temporary = `${output}.partial`, file = await open(temporaryPath(temporary), "w");
  let outputRows = 0, largestOutputRow = 0;
  try {
    if (input.metadata.format === "csv") await file.write(progress.header);
    for await (const row of createInterface({ input: createReadStream(sorted), crlfDelay: Infinity })) {
      input.signal?.throwIfAborted(); const separator = row.indexOf("\t"); if (separator < 0) throw new Error("The external source sort returned an invalid row.");
      const bytes = Buffer.from(row.slice(separator + 1), "base64");
      if (memory.hasSubscribers && (outputRows++ % 500 === 0 || bytes.length > largestOutputRow)) memory.publish({ stage: "sort-output", item: output, itemBytes: bytes.length, liveItems: 1 });
      largestOutputRow = Math.max(largestOutputRow, bytes.length);
      if (input.metadata.format === "json") { const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length); await file.write(header); }
      await file.write(bytes);
      if (input.metadata.format === "csv" && bytes.at(-1) !== 10) await file.write("\n");
    }
  } finally { await file.close(); }
  await rename(temporaryPath(temporary), temporaryPath(output)); await rm(temporaryPath(sorted)); await rm(temporaryPath(`${sorted}.ready`)); await rm(temporaryPath(input.path)); return output;
}
