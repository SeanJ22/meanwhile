import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/** Read actual broker usage for component and parent runs alike; this grants no sending authority. */
export async function diagnosticModelCalls(descriptorPath: string | undefined, phase: string, startedMs: number) {
  if (!descriptorPath) return [];
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  const ledger = new DatabaseSync(descriptor.budgetPath, { readOnly: true });
  try {
    return ledger.prepare("SELECT role,actual_usd,usage_json,request_hash,sent_at,response_at,bound_nanos/1000000000.0 AS reserved_usd FROM calls WHERE phase=? AND sent_at>=? ORDER BY id")
      .all(phase, new Date(startedMs).toISOString()).map(row => ({ role: String(row.role), usd: typeof row.actual_usd === "number" ? row.actual_usd : null,
        usage: typeof row.usage_json === "string" ? JSON.parse(row.usage_json) : null, requestHash: String(row.request_hash), sentAt: String(row.sent_at),
        responseAt: typeof row.response_at === "string" ? row.response_at : null, reservedUsd: Number(row.reserved_usd) }));
  } finally { ledger.close(); }
}

/** A recorded zero is a usage sum, not a total price when any attempted call remains unpriced. */
export function diagnosticModelSpend(calls: Awaited<ReturnType<typeof diagnosticModelCalls>>) {
  const unpricedCalls = calls.filter(row => row.usd === null).length;
  const unfinishedCalls = calls.filter(row => row.responseAt === null).length;
  const unmeteredCalls = calls.filter(row => row.usage === null).length;
  return { calls, measuredUsd: calls.reduce((sum, row) => sum + (row.usd ?? 0), 0),
    measuredUsdIsTotal: unpricedCalls === 0 && unfinishedCalls === 0 && unmeteredCalls === 0,
    unpricedCalls, unfinishedCalls, unmeteredCalls, reservedUsd: calls.reduce((sum, row) => sum + row.reservedUsd, 0) };
}

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
