import { createRequire } from "node:module";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { JsonFileCursor, jsonWatchKey } from "../repository/json-file-stream.ts";
import type { HistoryIndex } from "../workers/streamed-history.ts";

export type MirrorLane = "original" | "recent" | "history";
const LANES: readonly MirrorLane[] = ["original", "recent", "history"];
const VERIFIED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
type Positions = { nextByLane: Record<MirrorLane, number>; turn: number };
const fresh = (): Positions => ({ nextByLane: { original: 0, recent: 0, history: 0 }, turn: 0 });
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const sqlite = (file: string): HistoryIndex => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(file: string) => HistoryIndex };
  const db = new DatabaseSync(file);
  db.exec("PRAGMA cache_size=-1024; PRAGMA temp_store=FILE; PRAGMA journal_mode=DELETE");
  return db;
};
function initialize(db: HistoryIndex) {
  db.exec("CREATE TABLE cursor(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,next_original INTEGER NOT NULL,next_recent INTEGER NOT NULL,next_history INTEGER NOT NULL,turn INTEGER NOT NULL); CREATE TABLE verified(key TEXT PRIMARY KEY,at REAL NOT NULL)");
}
function savePositions(db: HistoryIndex, value: Positions) {
  db.prepare("INSERT OR REPLACE INTO cursor VALUES(1,2,?,?,?,?)").run(value.nextByLane.original, value.nextByLane.recent, value.nextByLane.history, value.turn);
}
async function legacyPositions(file: string, db: HistoryIndex): Promise<Positions> {
  const cursor = new JsonFileCursor(file), values = new Map<string, unknown>(); let verifiedObject = false;
  const put = db.prepare("INSERT OR REPLACE INTO verified VALUES(?,?)");
  const paths = [["version"], ["next"], ["turn"], ...LANES.map(lane => ["nextByLane", lane])];
  try {
    await cursor.value(undefined, undefined, [], {
      watch: new Map(paths.map(path => [jsonWatchKey(path), (value: unknown) => { values.set(jsonWatchKey(path), value); }])),
      objects: async (path, input) => {
        if (path.length !== 1 || path[0] !== "verifiedAt") return false;
        verifiedObject = true;
        await input.object(async key => {
          let at: unknown;
          await input.value(undefined, undefined, [], { watch: new Map([[jsonWatchKey([]), (value: unknown) => { at = value; }]]) });
          if (key.startsWith("freshness/") && typeof at === "number" && Number.isFinite(at) && at >= 0) put.run(key, at);
        });
        return true;
      },
    });
    await cursor.finish();
  } finally { await cursor.close(); }
  const get = (path: string[]) => values.get(jsonWatchKey(path));
  if (get(["version"]) === 2 && verifiedObject && integer(get(["turn"])) && LANES.every(lane => integer(get(["nextByLane", lane])))) {
    return { nextByLane: Object.fromEntries(LANES.map(lane => [lane, get(["nextByLane", lane])])) as Record<MirrorLane, number>, turn: Number(get(["turn"])) };
  }
  if (integer(get(["next"]))) { const value = fresh(); value.nextByLane.history = Number(get(["next"])); db.exec("DELETE FROM verified"); return value; }
  throw new Error("ADMIN_EVIDENCE_MIRROR_CURSOR_INVALID");
}

/** The existing operational cursor, with membership held on disk instead of a country-sized JSON object. */
export async function openAdminMirrorCursor(file: string, nowMs: number) {
  let format: "new" | "sqlite" | "legacy" = "new";
  try {
    const handle = await open(file, "r");
    try { const header = Buffer.alloc(16); await handle.read(header, 0, header.length, 0); format = header.toString("utf8") === "SQLite format 3\0" ? "sqlite" : "legacy"; }
    finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(file), { recursive: true });
  if (format === "legacy") {
    const temp = `${file}.${process.pid}.tmp`; await rm(temp, { force: true });
    const migrating = sqlite(temp);
    try {
      initialize(migrating); migrating.exec("BEGIN");
      savePositions(migrating, await legacyPositions(file, migrating)); migrating.exec("COMMIT");
      migrating.close(); await rename(temp, file);
    } catch (error) { try { migrating.close(); } catch {} await rm(temp, { force: true }); throw error; }
  }
  const db = sqlite(file);
  try {
    if (format === "new") { initialize(db); savePositions(db, fresh()); }
    const row = db.prepare("SELECT * FROM cursor WHERE id=1").get();
    if (!row || Number(row.version) !== 2 || ![row.next_original, row.next_recent, row.next_history, row.turn].every(value => integer(Number(value)))) throw new Error("ADMIN_EVIDENCE_MIRROR_CURSOR_INVALID");
    db.prepare("DELETE FROM verified WHERE at<=?").run(nowMs - VERIFIED_RECHECK_MS);
    const value: Positions = { nextByLane: { original: Number(row.next_original), recent: Number(row.next_recent), history: Number(row.next_history) }, turn: Number(row.turn) };
    let pendingVerified: readonly [string, number] | undefined;
    return {
      ...value,
      hasVerified: (key: string) => db.prepare("SELECT 1 FROM verified WHERE key=?").get(key) !== undefined,
      markVerified: (key: string, at: number) => { pendingVerified = [key, at]; },
      save() {
        db.exec("BEGIN");
        try { savePositions(db, this); if (pendingVerified) db.prepare("INSERT OR REPLACE INTO verified VALUES(?,?)").run(...pendingVerified); db.exec("COMMIT"); pendingVerified = undefined; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      },
      close: () => db.close(),
    };
  } catch (error) { db.close(); throw error; }
}
