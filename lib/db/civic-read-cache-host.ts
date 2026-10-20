import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

/** Only the supervisor touches disposable files; source doors stay off disk,
 * as required by the existing civic-data release firewall. */
export async function saveCivicReadCopy(root: string, key: string, saved: string): Promise<void> {
  const destination = join(root, key + ".json");
  const temporary = destination + "." + randomUUID() + ".tmp";
  try {
    await mkdir(root, { recursive: true });
    await writeFile(temporary, saved);
    await rename(temporary, destination);
  } catch { await unlink(temporary).catch(() => {}); }
}

/** Host-local copy sink, inherited by every child; a process that inherited one keeps using it.
 * It owns no civic authority: readers still ask Postgres for each row etag. */
export async function startCivicReadCacheHost(): Promise<{ close: () => Promise<void> }> {
  const database = process.env.DATABASE_URL;
  if (!database || (process.env.WTP_CIVIC_READ_CACHE_URL && process.env.WTP_CIVIC_READ_CACHE_TOKEN)) return { close: async () => {} };
  const root = join(process.cwd(), ".runtime", "civic-read-cache",
    createHash("sha256").update(database).digest("hex"));
  const token = randomUUID();
  const server = createServer(async (request, response) => {
    if (!["GET", "PUT"].includes(request.method ?? "") || request.headers.authorization !== token || !/^\/[a-f0-9]{64}$/.test(request.url ?? "")) {
      response.writeHead(404).end(); return;
    }
    try {
      if (request.method === "GET") {
        const saved = await readFile(join(root, request.url!.slice(1) + ".json"), "utf8");
        response.writeHead(200, { "content-type": "application/json" }).end(saved); return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      await saveCivicReadCopy(root, request.url!.slice(1), Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204).end();
    } catch { response.writeHead(request.method === "GET" ? 404 : 503).end(); }
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
