import { brotliDecompressSync } from "node:zlib";
import { resolveReaderArtifactStore } from "../meetings/edge-store.ts";
import { fileKey } from "./place-file.ts";
import { indexPointerKey, READER_INDEX_TAG } from "./place-files.ts";

/** A published file never changes, so no copy of it ever goes stale. */
const IMMUTABLE = { "Cache-Control": "public, max-age=31536000, immutable", "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable" } as const;
/** The pointer is the one file that moves: its copies live a minute, are served while they refresh, and are cleared by tag when the lane moves it. */
const POINTER = { "Cache-Control": "public, max-age=30, stale-while-revalidate=300", "Netlify-CDN-Cache-Control": "public, durable, max-age=60, stale-while-revalidate=600" } as const;
const MISSING = { "Cache-Control": "no-store" } as const;

/** One published file by its name, as stored: brotli, which every browser reads, or plain for a client that does not. These read the store and nothing else. */
export async function servePlaceFile(request: Request, name: string): Promise<Response> {
  const store = resolveReaderArtifactStore();
  if (!/^[0-9a-f]{16}$/.test(name) || !store) return new Response(null, { status: 404, headers: MISSING });
  const bytes = await store.readBytes(fileKey(name));
  if (!bytes) return new Response(null, { status: 404, headers: MISSING });
  const brotli = /\bbr\b/.test(request.headers.get("accept-encoding") ?? "");
  return new Response((brotli ? bytes : brotliDecompressSync(bytes)) as unknown as BodyInit, { headers: { ...IMMUTABLE, "Content-Type": "application/json; charset=utf-8", "Vary": "Accept-Encoding", ...(brotli ? { "Content-Encoding": "br" } : {}) } });
}

/** The pointer of a state: the names of its current index and of the national file. */
export async function servePlaceIndexPointer(state: string): Promise<Response> {
  const store = resolveReaderArtifactStore(), pointer = /^[A-Z]{2}$/.test(state) && store ? await store.readJsonPointer(indexPointerKey(state)) : null;
  return pointer ? Response.json(pointer.value, { headers: { ...POINTER, "Netlify-Cache-Tag": READER_INDEX_TAG(state) } }) : new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=10" } });
}
