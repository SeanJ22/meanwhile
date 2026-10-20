import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** A phase never appends to a prior run's accounting identity, including failed preparation. */
export async function reserveProductionReadRun(path: string, supplied?: string): Promise<string> {
  const id = supplied ?? randomUUID();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(id)) throw Error("RH01 production read run ID is invalid");
  if (supplied) try {
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity }))
      if (JSON.parse(line).runId === id) throw Error("RH01 production read run ID already has recorded reads");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const directory = join(dirname(path), "production-read-runs");
  await mkdir(directory, { recursive: true });
  try { await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, startedAt: new Date().toISOString() }) + "\n", { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw Error("RH01 production read run ID is already reserved"); throw error; }
  return id;
}

/** Stream one scalar ledger pass; delegated reads belong to the actual RPC caller. */
export async function physicalRunReads(path: string, runId: string, startedMs: number) {
  const owners = new Map<number, { reader: number; control: number }>();
  let reader = 0, control = 0;
  try {
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
      const row = JSON.parse(line);
      if (row.runId !== runId || Date.parse(row.at) < startedMs) continue;
      const owner = Number(row.ownerPid ?? row.pid), counts = owners.get(owner) ?? { reader: 0, control: 0 };
      if (row.database === "reader") { reader += row.bytes; counts.reader += row.bytes; }
      else if (row.database === "control-plane") { control += row.bytes; counts.control += row.bytes; }
      owners.set(owner, counts);
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { reader, control, owners };
}
