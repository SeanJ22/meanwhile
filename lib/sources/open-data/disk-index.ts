import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../../civic-data/temporary-path.ts";

type Value = string | number | null;
export interface DiskStatement {
  run(...values: Value[]): unknown;
  get(...values: Value[]): Record<string, unknown> | undefined;
  all(...values: Value[]): Record<string, unknown>[];
  iterate(...values: Value[]): Iterable<Record<string, unknown>>;
}
export async function openDataDiskIndex(schema: string) {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => {
    exec(sql: string): void; close(): void; prepare(sql: string): DiskStatement;
  } };
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-open-data-"));
  const db = new DatabaseSync(temporaryPath(join(directory, "index.sqlite")));
  try { db.exec(`PRAGMA cache_size=-1024; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; ${schema}`); }
  catch (error) { db.close(); await rm(directory, { recursive: true, force: true }); throw error; }
  return { db, async dispose() { db.close(); await rm(directory, { recursive: true, force: true }); } };
}
