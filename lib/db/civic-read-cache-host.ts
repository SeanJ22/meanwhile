import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export const CIVIC_READ_CACHE_MAX_BYTES = 2 * 1024 ** 3;
export const CIVIC_READ_COPY_MAX_BYTES = 64 * 1024 ** 2;

type CopyBody = string | AsyncIterable<Uint8Array>;

/** The copy host's own counts since it started: lookups answered, lookups with no copy, lookups the caller gave up on, and the store's state. */
export interface ReadCacheReading { readonly since: string; readonly hits: number; readonly misses: number; readonly timeouts: number;
  readonly bytes: number; readonly capBytes: number; readonly evicted: number; readonly oldestAgeMs: number | null }

/** One writer owns the entire disposable directory, including old database
 * namespaces. Reserve space before writing each chunk; oldest copies go first. */
export function civicReadCopyStore(root: string, maxBytes = CIVIC_READ_CACHE_MAX_BYTES, maxCopyBytes = CIVIC_READ_COPY_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxCopyBytes) || maxCopyBytes <= 0) throw new Error("CIVIC_READ_CACHE_LIMIT_INVALID");
  const entries = new Map<string, { size: number; at: number }>();
  let used = 0, evicted = 0, queue = Promise.resolve();
  const makeRoom = async (bytes: number): Promise<void> => {
    if (used + bytes <= maxBytes) return;
    for (const [path, entry] of entries) {
      if (used + bytes <= maxBytes) break;
      try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      used -= entry.size; evicted += 1; entries.delete(path);
    }
    if (used + bytes > maxBytes) throw new Error("CIVIC_READ_CACHE_FULL");
  };
  const ready = (async () => {
    const scan = async (directory: string): Promise<void> => {
      await mkdir(directory, { recursive: true });
      const files = await readdir(directory, { withFileTypes: true });
      for (let at = 0; at < files.length; at += 64) await Promise.all(files.slice(at, at + 64).map(async file => {
        const path = join(directory, file.name);
        if (file.isDirectory() && file.name !== "checkpoint") await scan(path);
        else if (file.isFile() && file.name.endsWith(".tmp")) await unlink(path);
        else if (file.isFile() && file.name.endsWith(".json")) {
          const info = await stat(path);
          entries.set(path, { size: info.size, at: info.mtimeMs }); used += info.size;
        }
      }));
    };
    await scan(root);
    const oldest = [...entries].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]));
    entries.clear();
    for (const [path, entry] of oldest) entries.set(path, entry);
    await makeRoom(0);
  })();
  // A failed scan is surfaced to each caller without an unhandled rejection.
  void ready.catch(() => {});
  return {
    ready,
    /** A copy that was read is the newest, so the oldest unread copies go first. */
    touch(key: string): void {
      const path = join(root, key + ".json"), entry = entries.get(path);
      if (entry) { entries.delete(path); entries.set(path, { ...entry, at: Date.now() }); }
    },
    /** What the store holds now: disk bytes, copies evicted since it started, and how long its least recently used copy has gone unread. */
    stats: () => ({ bytes: used, capBytes: maxBytes, evicted, oldestAgeMs: entries.size ? Math.round(Date.now() - entries.values().next().value!.at) : null }),
    write(key: string, body: CopyBody): Promise<void> {
      const work = queue.then(async () => {
        await ready;
        const destination = join(root, key + ".json");
        const temporary = destination + "." + randomUUID() + ".tmp";
        await mkdir(dirname(destination), { recursive: true });
        const file = await open(temporary, "wx");
        let size = 0, committed = false;
        try {
          const chunks = typeof body === "string" ? [Buffer.from(body)] : body;
          for await (const chunk of chunks) {
            if (size + chunk.byteLength > Math.min(maxBytes, maxCopyBytes)) throw new Error("CIVIC_READ_COPY_TOO_LARGE");
            await makeRoom(chunk.byteLength);
            // FileHandle.writeFile consumes this bounded chunk completely.
            await file.writeFile(chunk);
            size += chunk.byteLength; used += chunk.byteLength;
          }
          await file.close();
          const old = entries.get(destination);
          await rename(temporary, destination);
          used -= old?.size ?? 0;
          entries.delete(destination);
          entries.set(destination, { size, at: Date.now() });
          committed = true;
        } finally {
          await file.close().catch(() => {});
          if (!committed) { used -= size; await unlink(temporary).catch(() => {}); }
        }
      });
      queue = work.catch(() => {});
      return work;
    },
  };
}

/** Host-local copy sink inherited by every child. Each use still checks the
 * database content fingerprint. Disk copies, temporary writes and individual bodies are bounded. */
export async function startCivicReadCacheHost(options: { readonly maxBytes?: number; readonly maxCopyBytes?: number } = {}): Promise<{ close: () => Promise<void>; stats: () => ReadCacheReading | null }> {
  const database = process.env.DATABASE_URL;
  if (!database || (process.env.WTP_CIVIC_READ_CACHE_URL && process.env.WTP_CIVIC_READ_CACHE_TOKEN)) return { close: async () => {}, stats: () => null };
  const root = join(process.cwd(), ".runtime", "civic-read-cache");
  const namespace = createHash("sha256").update(database).digest("hex");
  const store = civicReadCopyStore(root, options.maxBytes, options.maxCopyBytes);
  await store.ready.catch(error => console.error(`Read cache unavailable; collection continues: ${error instanceof Error ? error.name : "error"}`));
  const token = randomUUID();
  const since = new Date().toISOString(), lookups = { hits: 0, misses: 0, timeouts: 0 };
  const server = createServer(async (request, response) => {
    if (!["GET", "PUT"].includes(request.method ?? "") || request.headers.authorization !== token || !/^\/(?:checkpoint\/)?[a-f0-9]{64}$/.test(request.url ?? "")) {
      response.writeHead(404).end(); return;
    }
    const key = namespace + request.url!, lookup = request.method === "GET" && !request.url!.startsWith("/checkpoint/");
    if (lookup) response.on("close", () => { if (!response.writableFinished) lookups.timeouts += 1; });
    try {
      const file = join(root, key + ".json");
      if (request.method === "GET") {
        await stat(file);
        if (lookup) { lookups.hits += 1; store.touch(key); }
        response.writeHead(200, { "content-type": "application/json" });
        await pipeline(createReadStream(file), response); return;
      }
      if (request.url!.startsWith("/checkpoint/")) {
        // Continuations survive ordinary copy eviction and host restarts. They are not facts or a receipt.
        await mkdir(dirname(file), { recursive: true });
        const temporary = file + "." + randomUUID() + ".tmp", held = await open(temporary, "wx", 0o600);
        let bytes = 0;
        try {
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > CIVIC_READ_COPY_MAX_BYTES) throw new Error("Job continuation exceeds the existing copy bound");
            await held.writeFile(chunk);
          }
          await held.sync(); await held.close(); await rename(temporary, file);
        } catch (error) { await held.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
        response.writeHead(204).end(); return;
      }
      const length = Number(request.headers["content-length"]);
      if (length > Math.min(options.maxBytes ?? CIVIC_READ_CACHE_MAX_BYTES, options.maxCopyBytes ?? CIVIC_READ_COPY_MAX_BYTES)) { response.writeHead(413).end(); request.resume(); return; }
      await store.write(key, request);
      response.writeHead(204).end();
    } catch {
      if (lookup && !response.headersSent) lookups.misses += 1;
      if (!response.headersSent) response.writeHead(request.method === "GET" ? 404 : 503).end();
      else response.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CIVIC_READ_CACHE_ADDRESS_UNAVAILABLE");
  process.env.WTP_CIVIC_READ_CACHE_URL = `http://127.0.0.1:${address.port}`;
  process.env.WTP_CIVIC_READ_CACHE_TOKEN = token;
  return { close: async () => {
    delete process.env.WTP_CIVIC_READ_CACHE_URL;
    delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }, stats: () => ({ since, ...lookups, ...store.stats() }) };
}
