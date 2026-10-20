import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { JsonFileCursor } from "../control-plane/repository/json-file-stream.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { TASK_ZIPS_KEY } from "../control-plane/live-audit-log.ts";
import { withHistoryIndex, type HistoryIndex } from "../control-plane/workers/streamed-history.ts";

interface PublishedZipOptions {readonly origin: string; readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number; readonly onlyZip?: string}
/** Stream the published county manifest through scratch storage, selecting ZIP scalars before assembling a member. */
async function visitPublishedZips(options: PublishedZipOptions, visit: (zip: string) => void): Promise<void> {
  if (options.onlyZip) {visit(options.onlyZip); return;}
  const response = await (options.fetchImpl ?? fetch)(`${options.origin}/api/reader/places`, {
    headers: {"x-wtp-synthetic-run": "keep-warm", accept: "application/json"}, signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok || !response.body) return;
  const directory = await mkdtemp(join(tmpdir(), "published-zips-"));
  const file = temporaryPath(join(directory, "places.json"));
  try {
    const target = await open(file, "wx"), body = response.body.getReader();
    try {for (;;) {const chunk = await body.read(); if (chunk.done) break; await target.writeFile(chunk.value);}}
    finally {await target.close(); body.releaseLock();}
    const cursor = new JsonFileCursor(file);
    try {
      await cursor.value(undefined, undefined, [], {arrays: async (path, input) => {
        if (path.length !== 1 || path[0] !== "places") return false;
        await input.array(async () => {
          const parts: string[] = [];
          await input.value(part => {parts.push(part);}, {zip: true, lat: true, lng: true});
          const place = JSON.parse(parts.join("")) as {zip?: unknown; lat?: unknown; lng?: unknown};
          if (typeof place?.zip === "string" && typeof place.lat === "number" && typeof place.lng === "number") visit(place.zip);
        });
        return true;
      }});
      await cursor.finish();
    } finally {await cursor.close();}
  } finally {await rm(directory, {recursive: true, force: true});}
}

function samples(db: HistoryIndex, wanted: number, now: string, remaining = false): string[] {
  const filter = remaining ? "WHERE NOT EXISTS(SELECT 1 FROM queued q WHERE q.zip=p.zip)" : "";
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM places p ${filter}`).get()!.count);
  const count = Math.max(0, Math.floor(wanted));
  if (count === 0 || total === 0) return [];
  if (total <= count) return [...db.prepare(`SELECT zip FROM places p ${filter} ORDER BY zip`).iterate()].map(row => row.zip);
  const day = Math.floor(Date.parse(now) / 86_400_000), stride = Math.max(1, Math.floor(total / count)), start = (day * 7919) % total;
  const nth = db.prepare(`SELECT zip FROM places p ${filter} ORDER BY zip LIMIT 1 OFFSET ?`), out: string[] = [];
  for (let index = 0; out.length < count && index < total * 2; index++) {
    const zip = nth.get((start + index * stride) % total)!.zip;
    if (!out.includes(zip)) out.push(zip);
  }
  return out;
}

export async function samplePublishedZips(options: PublishedZipOptions & {readonly count: number; readonly now: string}): Promise<string[]> {
  return withHistoryIndex(async db => {
    db.exec("CREATE TABLE places(zip TEXT PRIMARY KEY)");
    const insert = db.prepare("INSERT OR IGNORE INTO places VALUES(?)");
    await visitPublishedZips(options, zip => insert.run(zip));
    return samples(db, options.count, options.now);
  });
}

/** The complete new-place queue is on disk. It is consumed one ZIP at a time without limiting coverage. */
export async function withResidentZipSelection<T>(options: PublishedZipOptions & {
  readonly repos: Pick<ControlPlaneRepositories, "liveAudits"> | null; readonly count: number; readonly now: string; readonly queuedOnly: boolean;
}, work: (selection: {zips: AsyncIterable<string>; queued: Pick<ReadonlySet<string>, "has">; selected: number; published: number; queuedCount: number}) => Promise<T>): Promise<T> {
  return withHistoryIndex(async db => {
    db.exec("CREATE TABLE places(zip TEXT PRIMARY KEY); CREATE TABLE seen(zip TEXT PRIMARY KEY); CREATE TABLE queued(zip TEXT PRIMARY KEY); CREATE TABLE selected(sequence INTEGER PRIMARY KEY,zip TEXT NOT NULL UNIQUE)");
    const insert = db.prepare("INSERT OR IGNORE INTO places VALUES(?)");
    await visitPublishedZips(options, zip => insert.run(zip));
    if (options.repos && !options.onlyZip) {
      const seen = db.prepare("INSERT OR IGNORE INTO seen VALUES(?)");
      await options.repos.liveAudits.readChangedSince(null, undefined, {projection: {kind: true, zip: true}, page: rows => {
        for (const {key, record} of rows) if (key === TASK_ZIPS_KEY && record.kind === "TASK_ZIP") seen.run(record.zip);
      }});
    }
    if (!options.onlyZip) db.exec("INSERT INTO queued SELECT zip FROM places WHERE NOT EXISTS(SELECT 1 FROM seen WHERE seen.zip=places.zip)");
    const queuedCount = Number(db.prepare("SELECT COUNT(*) AS count FROM queued").get()!.count);
    db.exec("INSERT INTO selected SELECT row_number() OVER(ORDER BY zip)-1,zip FROM queued");
    if (!options.queuedOnly) {
      const add = db.prepare("INSERT INTO selected VALUES(?,?)");
      let sequence = queuedCount;
      for (const zip of samples(db, options.onlyZip ? 1 : Math.max(0, options.count - queuedCount), options.now, true)) add.run(sequence++, zip);
    }
    const held = db.prepare("SELECT zip FROM queued WHERE zip=?");
    const source = options.queuedOnly ? "SELECT zip FROM queued ORDER BY zip" : "SELECT zip FROM selected ORDER BY sequence";
    const zips = async function* () {for (const row of db.prepare(source).iterate()) yield row.zip;};
    return work({zips: zips(), queued: {has: zip => Boolean(held.get(zip))}, queuedCount,
      selected: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${options.queuedOnly ? "queued" : "selected"}`).get()!.count),
      published: Number(db.prepare("SELECT COUNT(*) AS count FROM places").get()!.count)});
  });
}
