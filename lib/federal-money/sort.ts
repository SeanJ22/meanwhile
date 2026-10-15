import { temporaryPath } from "../civic-data/temporary-path.ts";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseFederalMoney } from "./parse.ts";
import { federalMoneyPartitionOf } from "./model.ts";
import { federalCsvRecords } from "./streams.ts";
import type { FederalMoneyCapture, FederalMoneySource } from "./model.ts";

function key(source: FederalMoneySource, state: string, metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">, row: string, header: string): string {
  const fact = parseFederalMoney(source, { ...metadata, rawHash: "0".repeat(64), vaultKey: "", byteLength: 0 }, state, metadata.format === "csv" ? header + row : `[${row}]`)[0];
  if (!fact) throw new Error("A source sort record has no federal fact.");
  const partition = federalMoneyPartitionOf(fact);
  return `${partition.year}\x1f${partition.place}\x1f${createHash("sha256").update(fact.id).digest("hex")}`;
}
async function sortFile(input: string, output: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sort", ["--stable", "--buffer-size=16M", "--temporary-directory", dirname(input), "--field-separator=\t", "--key=1,1", "--output", output, input], { stdio: ["ignore", "ignore", "pipe"], signal, env: { ...process.env, LC_ALL: "C" } });
    let error = "";
    child.stderr.on("data", (value: Buffer) => { if (error.length < 4096) error += value.toString("utf8").slice(0, 4096 - error.length); });
    child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`Federal source external sort failed (${code}): ${error}`)));
  });
}
export async function sortFederalSourceFile(input: { source: FederalMoneySource; state: string; path: string; metadata: Omit<FederalMoneyCapture, "vaultKey" | "rawHash" | "byteLength">; signal?: AbortSignal }): Promise<string> {
  const output = `${input.path}.ordered`, keyed = `${input.path}.keys`, sorted = `${keyed}.sorted`, checkpoint = `${keyed}.state`;
  try { if ((await stat(output)).isFile()) return output; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let progress = { offset: 0, outputOffset: 0, header: "", complete: false };
  try { progress = JSON.parse(await readFile(checkpoint, "utf8")) as typeof progress; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!progress.complete) {
    const file = await open(temporaryPath(keyed), progress.outputOffset ? "r+" : "w"); await file.truncate(progress.outputOffset); let rows = 0;
    const save = async (complete = false) => { progress.complete = complete; await writeFile(temporaryPath(`${checkpoint}.next`), JSON.stringify(progress)); await rename(temporaryPath(`${checkpoint}.next`), temporaryPath(checkpoint)); rows = 0; };
    const write = async (row: string) => { const bytes = Buffer.from(`${key(input.source, input.state, input.metadata, row, progress.header)}\t${Buffer.from(row).toString("base64")}\n`); await file.write(bytes, 0, bytes.length, progress.outputOffset); progress.outputOffset += bytes.length; rows++; if (rows >= 500) await save(); };
    try {
      if (input.metadata.format === "csv") {
        for await (const row of federalCsvRecords(createReadStream(input.path, { start: progress.offset }))) {
          input.signal?.throwIfAborted(); progress.offset += Buffer.byteLength(row);
          if (!progress.header) { progress.header = row; continue; } if (row.trim()) await write(row);
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
  try {
    if (input.metadata.format === "csv") await file.write(progress.header);
    for await (const row of createInterface({ input: createReadStream(sorted), crlfDelay: Infinity })) {
      input.signal?.throwIfAborted(); const separator = row.indexOf("\t"); if (separator < 0) throw new Error("The external source sort returned an invalid row.");
      const bytes = Buffer.from(row.slice(separator + 1), "base64");
      if (input.metadata.format === "json") { const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length); await file.write(header); }
      await file.write(bytes);
      if (input.metadata.format === "csv" && bytes.at(-1) !== 10) await file.write("\n");
    }
  } finally { await file.close(); }
  await rename(temporaryPath(temporary), temporaryPath(output)); await rm(temporaryPath(sorted)); await rm(temporaryPath(`${sorted}.ready`)); await rm(temporaryPath(input.path)); return output;
}
