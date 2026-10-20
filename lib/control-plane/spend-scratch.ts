import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { temporaryPath } from "../civic-data/temporary-path.ts";

let scratch: {db: DatabaseSync; directory: string} | null = null, nextOwner = 0;
function database(): DatabaseSync {
  if (scratch) return scratch.db;
  const directory = mkdtempSync(join(tmpdir(), "meanwhile-spend-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(temporaryPath(join(directory, "spend.sqlite")));
  db.exec(`PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF;
    CREATE TABLE charges(sequence INTEGER PRIMARY KEY,owner INTEGER NOT NULL,id TEXT NOT NULL,job TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner,id));
    CREATE INDEX charges_job ON charges(owner,job);
    CREATE TABLE jobs(sequence INTEGER PRIMARY KEY,owner INTEGER NOT NULL,id TEXT NOT NULL,usd REAL NOT NULL,worst REAL NOT NULL,UNIQUE(owner,id));
    CREATE TABLE holds(owner INTEGER NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE held_jobs(owner INTEGER NOT NULL,id TEXT NOT NULL,worst REAL NOT NULL,held REAL NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE members(owner INTEGER NOT NULL,id TEXT NOT NULL,at REAL,PRIMARY KEY(owner,id));`);
  scratch = {db, directory};
  return db;
}
function forget(owner: number): void {
  if (!scratch) return;
  for (const table of ["charges", "jobs", "holds", "held_jobs", "members"]) scratch.db.prepare(`DELETE FROM ${table} WHERE owner=?`).run(owner);
}
const owners = new FinalizationRegistry<number>(forget);
process.once("exit", () => {
  if (!scratch) return;
  scratch.db.close(); rmSync(temporaryPath(scratch.directory), {recursive: true, force: true}); scratch = null;
});
/** One process-local cache for operational cost snapshots and joins; country rows stay on disk. */
export function spendScratch() {
  const owner = nextOwner++, db = database();
  return {owner, db, release: () => forget(owner)};
}
export function retainSpendScratch(value: object, owner: number): void { owners.register(value, owner); }

/** Repeated traversal does not retain a mapped copy. Input must itself be repeatable when used more than once. */
export function mapIterable<T, U>(values: Iterable<T>, map: (value: T) => U): Iterable<U> {
  return {[Symbol.iterator]: function* () { for (const value of values) yield map(value); }};
}
export function filterIterable<T>(values: Iterable<T>, keep: (value: T) => boolean): Iterable<T> {
  return {[Symbol.iterator]: function* () { for (const value of values) if (keep(value)) yield value; }};
}
