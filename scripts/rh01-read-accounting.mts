import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

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
