/**
 * Every whole-table read of a Postgres control-plane table answers from one held copy of that table on the
 * runner's disk, shared by every runner process. A read opens the copy, asks the database only for rows whose
 * `changed_at` is at or after the copy's read clock minus a slack, merges them into the copy as it streams it,
 * and writes the merged copy back by atomic rename. Logs are insert-only and aggregates change only by
 * compare-and-set and are never deleted (the database refuses anything else), so a merge never forgets a row.
 * Nothing is kept in memory between reads: a process holds a table only while its caller does.
 */

import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, unlink, type FileHandle } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { withCallerSite } from "../../db/transfer-by-caller.ts";
import type { ChangedRecord, ChangedRecords, ChangedRows, Persisted } from "./types.ts";

/** How far before a copy's read clock the next read reaches back; every control-plane write is one bounded statement shorter than this. */
export const INCREMENTAL_READS_SLACK_MS = 120_000;

/** Where the runner keeps the held copies. The standing runner sets it for itself and every child it starts. */
export const CONTROL_PLANE_READS_DIR_ENV = "WTP_CONTROL_PLANE_READS_DIR";

const COPY_FORMAT = 1;
const HEADER_LIMIT_BYTES = 4_096;
const WRITE_CHUNK_CHARS = 1 << 20;
/** A temporary file this old belongs to a writer that died; a live write finishes in seconds. */
const ABANDONED_WRITE_MS = 3_600_000;

/** The database a connection string names, as a hash of its host and database name. Never the credential. */
export function databaseIdentity(connectionString: string): string {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase().replace("-pooler.", ".");
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return createHash("sha256").update(`${host}/${database}`).digest("hex").slice(0, 16);
}

/** One directory of held copies (one database, one schema version) and this process's per-table queue. */
export interface HeldCopies {
  readonly dir: string;
  readonly log: (line: string) => void;
  /** One read of a table at a time in this process; other processes rely on the atomic rename. */
  serial<R>(table: string, operation: () => Promise<R>): Promise<R>;
}

const heldByDir = new Map<string, HeldCopies>();

/** The held copies under `dir`, one instance per directory per process. */
export function heldCopiesIn(dir: string, log: (line: string) => void = line => console.warn(line)): HeldCopies {
  const known = heldByDir.get(dir);
  if (known) return known;
  const queues = new Map<string, Promise<unknown>>();
  const copies: HeldCopies = {
    dir,
    log,
    serial(table, operation) {
      const next = (queues.get(table) ?? Promise.resolve()).then(operation, operation);
      queues.set(table, next.catch(() => undefined));
      return next;
    },
  };
  heldByDir.set(dir, copies);
  void removeAbandonedWrites(dir);
  return copies;
}

async function removeAbandonedWrites(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".tmp")) continue;
      const path = join(dir, name);
      if (Date.now() - (await stat(path)).mtimeMs > ABANDONED_WRITE_MS) await unlink(path).catch(() => {});
    }
  } catch { /* no copies yet */ }
}

/**
 * The held copies for this database and schema version, or null when this process has no runner disk (a page
 * host or a hand-run script): then every whole-table read is a first read. Copies for an older schema version of
 * the same database are removed, since nothing reads them again.
 */
export function heldCopiesFromEnv(
  connectionString: string,
  schemaVersion: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): HeldCopies | null {
  const root = env[CONTROL_PLANE_READS_DIR_ENV]?.trim();
  if (!root) return null;
  const database = databaseIdentity(connectionString);
  const name = `${database}-schema${schemaVersion}`;
  const dir = join(root, name);
  if (!heldByDir.has(dir)) {
    void readdir(root).then(names => Promise.all(names
      .filter(other => other !== name && other.startsWith(`${database}-schema`) &&
        Number(other.slice(`${database}-schema`.length)) < schemaVersion)
      .map(other => rm(join(root, other), { recursive: true, force: true })))).catch(() => {});
  }
  return heldCopiesIn(dir);
}

class UnreadableCopy extends Error {}

/** How one table's rows sit in its copy: the stored line, the order rows are kept and returned in, and which of two rows for one slot wins. */
interface Layout<R> {
  readonly encode: (row: R) => unknown[];
  readonly decode: (line: unknown[]) => R;
  /** Zero means the same slot: one aggregate id, or one log position under one key. */
  readonly order: (a: R, b: R) => number;
  readonly replaces: (incoming: R, held: R) => boolean;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isText = (value: unknown): value is string => typeof value === "string";

function aggregateLayout<T>(): Layout<Persisted<T>> {
  return {
    encode: row => [row.id, row.revision, row.updatedAt, row.value],
    decode: ([id, revision, updatedAt, value]) => {
      if (!isText(id) || !Number.isSafeInteger(revision) || !isText(updatedAt)) throw new UnreadableCopy("a row lacks its id, revision or time");
      return { id, revision: revision as number, updatedAt, value: value as T };
    },
    order: (a, b) => compareText(a.id, b.id),
    replaces: (incoming, held) => incoming.revision > held.revision,
  };
}

function logLayout<T>(): Layout<ChangedRecord<T>> {
  return {
    encode: entry => [entry.key, entry.recordId, entry.position, entry.record],
    decode: ([key, recordId, position, record]) => {
      if (!isText(key) || !isText(recordId) || !Number.isSafeInteger(position)) throw new UnreadableCopy("a record lacks its key, id or position");
      return { key, recordId, position: position as number, record: record as T };
    },
    order: (a, b) => compareText(a.key, b.key) || a.position - b.position,
    replaces: () => false,
  };
}

interface Header { readonly through: string; readonly bodyStart: number }

async function readHeader(handle: FileHandle, table: string): Promise<Header> {
  const buffer = Buffer.alloc(HEADER_LIMIT_BYTES);
  const { bytesRead } = await handle.read(buffer, 0, HEADER_LIMIT_BYTES, 0);
  const end = buffer.subarray(0, bytesRead).indexOf(0x0a);
  if (end < 0) throw new UnreadableCopy("no header line");
  let header: { format?: unknown; table?: unknown; through?: unknown };
  try { header = JSON.parse(buffer.subarray(0, end).toString("utf8")); }
  catch { throw new UnreadableCopy("the header is not JSON"); }
  if (header.format !== COPY_FORMAT || header.table !== table || !isText(header.through) || Number.isNaN(Date.parse(header.through))) {
    throw new UnreadableCopy("the header names another format, table or clock");
  }
  return { through: header.through, bodyStart: end + 1 };
}

/** Writes a copy beside its target and renames it into place only when it is whole. A failed write never fails the read. */
class CopyWriter {
  readonly #stream: WriteStream;
  readonly #path: string;
  #chunk: string[] = [];
  #size = 0;
  #error: unknown = null;

  constructor(path: string) {
    this.#path = path;
    this.#stream = createWriteStream(path, { flags: "wx", encoding: "utf8" });
    this.#stream.on("error", error => { this.#error ??= error; });
  }

  async line(text: string): Promise<void> {
    this.#chunk.push(text, "\n");
    this.#size += text.length + 1;
    if (this.#size >= WRITE_CHUNK_CHARS) await this.#flush();
  }

  async #flush(): Promise<void> {
    if (this.#error !== null) throw this.#error;
    const text = this.#chunk.join("");
    this.#chunk = [];
    this.#size = 0;
    if (text && !this.#stream.write(text)) await once(this.#stream, "drain");
  }

  async commit(target: string): Promise<void> {
    await this.#flush();
    this.#stream.end();
    await finished(this.#stream);
    if (this.#error !== null) throw this.#error;
    await rename(this.#path, target);
  }

  async discard(): Promise<void> {
    this.#stream.destroy();
    await unlink(this.#path).catch(() => {});
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function sinceOf(through: string, slackMs: number): string {
  return new Date(Date.parse(through) - slackMs).toISOString();
}

function laterOf(a: string | null, b: string): string {
  return a === null || Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Stream the held copy (sorted by `layout.order`) merged with the changed rows, handing each row to `out`, and
 * write the merged copy when anything moved. `handle` is the copy opened before the changed rows were asked
 * for, so a copy renamed in meanwhile cannot pair an older body with a newer clock.
 */
async function mergeCopy<R, O>(input: {
  readonly copies: HeldCopies;
  readonly table: string;
  readonly layout: Layout<R>;
  readonly held: { readonly handle: FileHandle; readonly header: Header } | null;
  readonly changed: readonly R[];
  readonly through: string;
  readonly out: (row: R) => O;
}): Promise<O[]> {
  const { copies, table, layout, held } = input;
  const target = join(copies.dir, `${table}.ndjson`);
  const changed = [...input.changed].sort(layout.order);
  let writer: CopyWriter | null = null;
  if (held === null || changed.length > 0) {
    try {
      await mkdir(copies.dir, { recursive: true });
      writer = new CopyWriter(`${target}.${process.pid}.${randomUUID()}.tmp`);
    } catch (error) {
      copies.log(`held copy of ${table} could not be written (${describe(error)}); the next read asks again`);
    }
  }
  const write = async (text: string) => {
    if (writer === null) return;
    try { await writer.line(text); }
    catch (error) {
      copies.log(`held copy of ${table} could not be written (${describe(error)}); the next read asks again`);
      await writer.discard();
      writer = null;
    }
  };
  try {
    await write(JSON.stringify({ format: COPY_FORMAT, table, through: laterOf(held?.header.through ?? null, input.through) }));
    const rows: O[] = [];
    let moved = held === null;
    let written = 0;
    const take = async (row: R, line?: string) => {
      rows.push(input.out(row));
      written += 1;
      await write(line ?? JSON.stringify(layout.encode(row)));
    };
    let next = 0;
    if (held !== null) {
      const lines = createInterface({ input: held.handle.createReadStream({ start: held.header.bodyStart, autoClose: false, encoding: "utf8" }), crlfDelay: Infinity });
      let previous: R | null = null;
      let count = 0;
      let end: { rows?: unknown } | null = null;
      for await (const line of lines) {
        if (end !== null) throw new UnreadableCopy("rows follow the end line");
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { throw new UnreadableCopy("a line is not JSON"); }
        if (!Array.isArray(parsed)) { end = parsed as { rows?: unknown }; continue; }
        const row = layout.decode(parsed);
        if (previous !== null && layout.order(previous, row) >= 0) throw new UnreadableCopy("rows are out of order");
        previous = row;
        count += 1;
        while (next < changed.length && layout.order(changed[next], row) < 0) { await take(changed[next++]); moved = true; }
        if (next < changed.length && layout.order(changed[next], row) === 0) {
          const incoming = changed[next++];
          if (layout.replaces(incoming, row)) { await take(incoming); moved = true; continue; }
        }
        await take(row, line);
      }
      if (end?.rows !== count) throw new UnreadableCopy(`the end line does not count its ${count} rows`);
    }
    while (next < changed.length) { await take(changed[next++]); moved = true; }
    await write(JSON.stringify({ rows: written }));
    const finishing = writer as CopyWriter | null;
    writer = null;
    if (finishing !== null) {
      if (!moved) await finishing.discard();
      else {
        try { await finishing.commit(target); }
        catch (error) {
          copies.log(`held copy of ${table} could not be written (${describe(error)}); the next read asks again`);
          await finishing.discard();
        }
      }
    }
    return rows;
  } finally {
    if (writer !== null) await (writer as CopyWriter).discard();
  }
}

async function readHeld<R, O>(
  copies: HeldCopies | null,
  table: string,
  layout: Layout<R>,
  slackMs: number,
  fetch: (since: string | null) => Promise<{ readonly rows: readonly R[]; readonly through: string | null }>,
  out: (row: R) => O,
): Promise<O[]> {
  const ask = async (since: string | null) => {
    const changed = await fetch(since);
    if (changed.through === null || Number.isNaN(Date.parse(changed.through))) {
      throw new Error(`${table}: the changed-since read returned no read clock`);
    }
    return { rows: changed.rows, through: changed.through };
  };
  if (copies === null) {
    const all = await ask(null);
    return [...all.rows].sort(layout.order).map(out);
  }
  return copies.serial(table, async () => {
    let handle: FileHandle | null = null;
    try {
      try { handle = await open(join(copies.dir, `${table}.ndjson`), "r"); }
      catch (error) { if ((error as { code?: unknown }).code !== "ENOENT") copies.log(`held copy of ${table} could not be opened (${describe(error)}); it is filled again`); }
      let header: Header | null = null;
      if (handle !== null) {
        try { header = await readHeader(handle, table); }
        catch (error) { copies.log(`held copy of ${table} is unreadable (${describe(error)}); it is filled again`); }
      }
      const held = handle !== null && header !== null ? { handle, header } : null;
      const changed = await ask(held === null ? null : sinceOf(held.header.through, slackMs));
      try {
        return await mergeCopy({ copies, table, layout, held, changed: changed.rows, through: changed.through, out });
      } catch (error) {
        if (!(error instanceof UnreadableCopy) || held === null) throw error;
        copies.log(`held copy of ${table} is unreadable (${error.message}); it is filled again`);
        const all = await ask(null);
        return mergeCopy({ copies, table, layout, held: null, changed: all.rows, through: all.through, out });
      }
    } finally {
      await handle?.close();
    }
  });
}

/** `list()` for one aggregate table: rows in id order, each mapped by `out` as it streams. */
export function heldAggregateList<T>(
  table: string,
  changedSince: (since: string | null) => Promise<ChangedRows<T>>,
  copies: HeldCopies | null,
  slackMs: number = INCREMENTAL_READS_SLACK_MS,
): <O>(out: (row: Persisted<T>) => O) => Promise<O[]> {
  const layout = aggregateLayout<T>();
  return out => withCallerSite(() => readHeld(copies, table, layout, slackMs, changedSince, out));
}

/** `readAll()` for one log table: records in key then position order. */
export function heldLogReadAll<T>(
  table: string,
  changedSince: (since: string | null) => Promise<ChangedRecords<T>>,
  copies: HeldCopies | null,
  slackMs: number = INCREMENTAL_READS_SLACK_MS,
): () => Promise<T[]> {
  const layout = logLayout<T>();
  const fetch = async (since: string | null) => {
    const changed = await changedSince(since);
    return { rows: changed.records, through: changed.through };
  };
  return () => withCallerSite(() => readHeld(copies, table, layout, slackMs, fetch, entry => entry.record));
}
