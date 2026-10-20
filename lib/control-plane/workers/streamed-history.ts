import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import type { AggregateRepository, AppendOnlyRepository, Persisted, RecordProjection } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";

/** A system pass streams pages; a task reads a single area's rows through the indexed repository methods. */
export async function forEachAggregate<T>(repo: AggregateRepository<T>, visit: (row: Persisted<T>) => Promise<void> | void,
  projection?: RecordProjection): Promise<void> {
  if (repo.listChangedSince) {
    await repo.listChangedSince(null, undefined, { projection, page: async rows => { for (const row of rows) await visit(row); } });
    return;
  }
  // Older local stores expose the same identity metadata without a page API.
  for (const slot of await repo.listNarrowed({})) {
    const row = projection ? await repo.readNarrowed(slot.id, projection) : await repo.read(slot.id);
    if (row) await visit(row as Persisted<T>);
  }
}

export interface HistoryIndex {
  exec(sql: string): void; close(): void;
  prepare(sql: string): {
    run(...values: (string|number)[]): void;
    get(...values: (string|number)[]): Record<string, string> | undefined;
    iterate(...values: (string|number)[]): Iterable<Record<string, string>>;
  };
}
export async function openHistoryIndex(): Promise<{db:HistoryIndex;directory:string}> {
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-history-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => HistoryIndex };
  const db = new DatabaseSync(temporaryPath(join(directory, "history.sqlite")));
  db.exec("PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF");
  return {db,directory};
}
export async function closeHistoryIndex(index: {readonly db:HistoryIndex;readonly directory:string}): Promise<void> {
  index.db.close(); await rm(temporaryPath(index.directory),{recursive:true,force:true});
}
export async function withHistoryIndex<T>(work: (db: HistoryIndex) => Promise<T>): Promise<T> {
  const {db,directory}=await openHistoryIndex();
  try { return await work(db); }
  finally { db.close(); await rm(temporaryPath(directory),{recursive:true,force:true}); }
}

/** Preserve recorded-time order without an array containing the country's capture metadata. */
export async function forEachRecorded<T extends {readonly recordedAt: string}>(repo: AppendOnlyRepository<T>,
  visit: (record: T) => Promise<boolean|void> | boolean|void, projection?: RecordProjection): Promise<void> {
  await withHistoryIndex(async db => {
    db.exec("CREATE TABLE records(sequence INTEGER PRIMARY KEY, recorded_at TEXT NOT NULL, body TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO records VALUES(?,?,?)"); let sequence = 0;
    await repo.readChangedSince(null, undefined, { projection, page: rows => {
      for (const {record} of rows) insert.run(sequence++, record.recordedAt, JSON.stringify(record));
    } });
    for (const row of db.prepare("SELECT body FROM records ORDER BY recorded_at,sequence").iterate()) {
      if (await visit(JSON.parse(row.body) as T) === false) break;
    }
  });
}

interface LatestScoutIndex {readonly db:HistoryIndex;readonly directory:string;through:string|null}
const latestScoutIndexes=new WeakMap<AppendOnlyRepository<ScoutResult>,Promise<LatestScoutIndex>>();
const openLatestIndexes=new Set<LatestScoutIndex>();
process.once("exit",()=>{for(const index of openLatestIndexes){index.db.close();rmSync(temporaryPath(index.directory),{recursive:true,force:true});}});

/** Fetch only changed rows after the first pass. Every latest result still receives upkeep on every pass. */
export async function forEachLatestScout(repo: AppendOnlyRepository<ScoutResult>, visit: (result: ScoutResult) => Promise<void>): Promise<void> {
  let opening=latestScoutIndexes.get(repo);
  if(!opening){opening=(async()=>{
    const held={...await openHistoryIndex(),through:null};
    held.db.exec("CREATE TABLE latest(subject TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, log_key TEXT NOT NULL, position INTEGER NOT NULL, first_at TEXT NOT NULL, first_key TEXT NOT NULL, first_position INTEGER NOT NULL, body TEXT NOT NULL)");
    openLatestIndexes.add(held);return held;
  })();latestScoutIndexes.set(repo,opening);}
  const index=await opening,db=index.db;
  const newer="excluded.recorded_at>latest.recorded_at OR (excluded.recorded_at=latest.recorded_at AND (excluded.log_key>latest.log_key OR (excluded.log_key=latest.log_key AND excluded.position>=latest.position)))";
  const earlier="excluded.first_at<latest.first_at OR (excluded.first_at=latest.first_at AND (excluded.first_key<latest.first_key OR (excluded.first_key=latest.first_key AND excluded.first_position<latest.first_position)))";
    const upsert = db.prepare(`INSERT INTO latest VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(subject) DO UPDATE SET
      body=CASE WHEN ${newer} THEN excluded.body ELSE latest.body END,
      position=CASE WHEN ${newer} THEN excluded.position ELSE latest.position END,
      log_key=CASE WHEN ${newer} THEN excluded.log_key ELSE latest.log_key END,
      recorded_at=MAX(latest.recorded_at,excluded.recorded_at),
      first_position=CASE WHEN ${earlier} THEN excluded.first_position ELSE latest.first_position END,
      first_key=CASE WHEN ${earlier} THEN excluded.first_key ELSE latest.first_key END,
      first_at=MIN(latest.first_at,excluded.first_at)`);
    const since=index.through===null?null:new Date(Date.parse(index.through)-60_000).toISOString();
    const changed=await repo.readChangedSince(since, undefined, { page: rows => {
      for (const {record,key,position} of rows) upsert.run(`${record.subjectId}\0${record.recordClass}`,record.recordedAt,key,position,record.recordedAt,key,position,JSON.stringify(record));
    } });
    index.through=changed.through;
    for (const row of db.prepare("SELECT body FROM latest ORDER BY first_at,first_key,first_position").iterate()) await visit(JSON.parse(row.body) as ScoutResult);
}
