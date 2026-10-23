import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export const CIVIC_READ_CACHE_MAX_BYTES = 2 * 1024 ** 3;
export const CIVIC_READ_COPY_MAX_BYTES = 64 * 1024 ** 2;

type CopyBody = string | AsyncIterable<Uint8Array>;

/** One writer owns the entire disposable directory, including old database
 * namespaces. Reserve space before writing each chunk; oldest copies go first. */
export function civicReadCopyStore(root: string, maxBytes = CIVIC_READ_CACHE_MAX_BYTES, maxCopyBytes = CIVIC_READ_COPY_MAX_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxCopyBytes) || maxCopyBytes <= 0) {
    throw new Error("CIVIC_READ_CACHE_LIMIT_INVALID");
  }
  const entries = new Map<string, { size: number; at: number }>();
  let used = 0;
  let queue = Promise.resolve();
  const makeRoom = async (bytes: number): Promise<void> => {
    for (const [path, entry] of [...entries].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))) {
      if (used + bytes <= maxBytes) break;
      try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      used -= entry.size; entries.delete(path);
    }
    if (used + bytes > maxBytes) throw new Error("CIVIC_READ_CACHE_FULL");
  };
  const ready = (async () => {
    const scan = async (directory: string): Promise<void> => {
      await mkdir(directory, { recursive: true });
      for (const file of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, file.name);
        if (file.isDirectory()) await scan(path);
        else if (file.isFile() && file.name.endsWith(".tmp")) await unlink(path);
        else if (file.isFile() && file.name.endsWith(".json")) {
          const info = await stat(path);
          entries.set(path, { size: info.size, at: info.mtimeMs }); used += info.size;
        }
      }
    };
    await scan(root);
    await makeRoom(0);
  })();
  // A failed scan is surfaced to each caller without an unhandled rejection.
  void ready.catch(() => {});
  return {
    ready,
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

const stores = new Map<string, ReturnType<typeof civicReadCopyStore>>();
/** Only the supervisor touches disposable files; source doors stay off disk. */
export async function saveCivicReadCopy(root: string, key: string, saved: string): Promise<void> {
  let store = stores.get(root);
  if (!store) { store = civicReadCopyStore(root); stores.set(root, store); }
  try { await store.write(key, saved); } catch { /* A disposable copy cannot fail the actual database read. */ }
}

/** Host-local copy sink inherited by every child. Each use still checks the
 * database etag. Disk copies, temporary writes and individual bodies are bounded. */
export async function startCivicReadCacheHost(options: { readonly maxBytes?: number; readonly maxCopyBytes?: number } = {}): Promise<{ close: () => Promise<void> }> {
  const database = process.env.DATABASE_URL;
  if (!database || (process.env.WTP_CIVIC_READ_CACHE_URL && process.env.WTP_CIVIC_READ_CACHE_TOKEN)) return { close: async () => {} };
  const root = join(process.cwd(), ".runtime", "civic-read-cache");
  const namespace = createHash("sha256").update(database).digest("hex");
  const store = civicReadCopyStore(root, options.maxBytes, options.maxCopyBytes);
  void store.ready.catch(error => console.error(`Read cache unavailable; collection continues: ${error instanceof Error ? error.name : "error"}`));
  const token = randomUUID();
  const server = createServer(async (request, response) => {
    if (!["GET", "PUT"].includes(request.method ?? "") || request.headers.authorization !== token || !/^\/[a-f0-9]{64}$/.test(request.url ?? "")) {
      response.writeHead(404).end(); return;
    }
    const key = namespace + request.url!;
    try {
      if (request.method === "GET") {
        const file = join(root, key + ".json");
        await stat(file);
        response.writeHead(200, { "content-type": "application/json" });
        await pipeline(createReadStream(file), response); return;
      }
      const length = Number(request.headers["content-length"]);
      if (length > Math.min(options.maxBytes ?? CIVIC_READ_CACHE_MAX_BYTES, options.maxCopyBytes ?? CIVIC_READ_COPY_MAX_BYTES)) {
        response.writeHead(413).end(); request.resume(); return;
      }
      await store.write(key, request);
      response.writeHead(204).end();
    } catch {
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
  } };
}
