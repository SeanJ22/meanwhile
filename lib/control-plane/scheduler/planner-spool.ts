import { rmSync } from "node:fs";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { openHistoryIndex, closeHistoryIndex } from "../workers/streamed-history.ts";
import { DiskRows } from "./disk-rows.ts";

/** Temporary planner rows, not another durable work ledger. Only the selected row is decoded. */
export async function createPlannerSpool() {
  const index = await openHistoryIndex(), db = index.db;
  db.exec("CREATE TABLE planner_rows(kind TEXT NOT NULL,key TEXT NOT NULL,position INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,key)); CREATE INDEX planner_order ON planner_rows(kind,position)");
  let position = 0, closed = false;
  const clean = () => { if (closed) return; closed = true; db.close(); rmSync(temporaryPath(index.directory), { recursive: true, force: true }); };
  process.once("exit", clean);
  return {
    table<T>(kind: string, keyOf: (row: T) => string, order: "key" | "position" = "position") {
      const put = db.prepare("INSERT INTO planner_rows VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET body=excluded.body"),
        get = db.prepare("SELECT body FROM planner_rows WHERE kind=? AND key=?"),
        count = db.prepare("SELECT count(*) AS n FROM planner_rows WHERE kind=?"),
        remove = db.prepare("DELETE FROM planner_rows WHERE kind=? AND key=?");
      const rows = new DiskRows<T>(function* () {
        for (const row of db.prepare(`SELECT body FROM planner_rows WHERE kind=? ORDER BY ${order}`).iterate(kind)) yield JSON.parse(row.body) as T;
      }, () => Number(count.get(kind)!.n));
      return {
        rows,
        keys: new DiskRows<string>(function* () { for (const row of db.prepare("SELECT key FROM planner_rows WHERE kind=? ORDER BY key").iterate(kind)) yield row.key; }, () => Number(count.get(kind)!.n)),
        rowsBy(fields: readonly (readonly string[])[]) {
          const paths = fields.map(path => "$" + path.map(key => `.${JSON.stringify(key)}`).join(""));
          return new DiskRows<T>(function* () {
            for (const row of db.prepare(`SELECT body FROM planner_rows WHERE kind=? ORDER BY ${fields.map(() => "json_extract(body,?)").join(",")}${fields.length ? "," : ""}position`).iterate(kind, ...paths)) yield JSON.parse(row.body) as T;
          }, () => Number(count.get(kind)!.n));
        },
        rowsWhere(path: readonly string[], value: string) {
          const at = "$" + path.map(key => `.${JSON.stringify(key)}`).join("");
          return new DiskRows<T>(function* () {
            for (const row of db.prepare("SELECT body FROM planner_rows WHERE kind=? AND json_extract(body,?)=? ORDER BY position").iterate(kind, at, value)) yield JSON.parse(row.body) as T;
          });
        },
        add(row: T) { put.run(kind, keyOf(row), position++, JSON.stringify(row)); },
        read(key: string): T | undefined { const row = get.get(kind, key); return row ? JSON.parse(row.body) as T : undefined; },
        has(key: string) { return get.get(kind, key) !== undefined; },
        delete(key: string) { remove.run(kind, key); },
        clear() { db.prepare("DELETE FROM planner_rows WHERE kind=?").run(kind); },
      };
    },
    async close() { if (closed) return; closed = true; process.removeListener("exit", clean); await closeHistoryIndex(index); },
  };
}
export type PlannerSpool = Awaited<ReturnType<typeof createPlannerSpool>>;
export interface PlannerTable<T> {
  readonly rows: DiskRows<T>;
  readonly keys: DiskRows<string>;
  rowsBy(fields: readonly (readonly string[])[]): DiskRows<T>;
  rowsWhere(path: readonly string[], value: string): DiskRows<T>;
  add(row: T): void;
  read(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
}

export function plannerMap<V>(planner: PlannerSpool, name: string, values: Iterable<readonly [string, V]> = []): Map<string, V> {
  const table = planner.table<{ key: string; value: V }>(name, row => row.key);
  for (const [key, value] of values) table.add({ key, value });
  const view = {
    get size() { return table.rows.length; }, get: (key: string) => table.read(key)?.value, has: (key: string) => table.has(key),
    set(key: string, value: V) { table.add({ key, value }); return view; }, delete(key: string) { const held = table.has(key); table.delete(key); return held; }, clear: () => table.clear(),
    *entries(): IterableIterator<[string, V]> { for (const row of table.rows) yield [row.key, row.value]; },
    *keys(): IterableIterator<string> { yield* table.keys; }, *values(): IterableIterator<V> { for (const row of table.rows) yield row.value; },
    [Symbol.iterator](): IterableIterator<[string, V]> { return view.entries(); },
    forEach(visit: (value: V, key: string, map: Map<string, V>) => void, receiver?: unknown) { for (const row of table.rows) visit.call(receiver, row.value, row.key, view as unknown as Map<string, V>); },
  };
  return view as unknown as Map<string, V>;
}

export function plannerSet(planner: PlannerSpool, name: string, values: Iterable<string> = []): Set<string> {
  const table = planner.table<string>(name, row => row);
  for (const value of values) table.add(value);
  const view = {
    get size() { return table.rows.length; }, has: (key: string) => table.has(key),
    add(key: string) { table.add(key); return view; }, delete(key: string) { const held = table.has(key); table.delete(key); return held; }, clear: () => table.clear(),
    *entries(): IterableIterator<[string, string]> { for (const key of table.keys) yield [key, key]; },
    *keys(): IterableIterator<string> { yield* table.keys; }, *values(): IterableIterator<string> { yield* table.keys; },
    [Symbol.iterator](): IterableIterator<string> { return view.keys(); },
    forEach(visit: (value: string, key: string, set: Set<string>) => void, receiver?: unknown) { for (const key of table.keys) visit.call(receiver, key, key, view as unknown as Set<string>); },
  };
  return view as unknown as Set<string>;
}
