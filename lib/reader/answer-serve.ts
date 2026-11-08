import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { answerPath, assembleAnswer, assembleBoard, boardPath, boardVersion, easternDay } from "./answer.ts";
import type { PlaceFile } from "./place-file.ts";
import { getFile, openPlaceFiles } from "./place-files.ts";
import { READER_ZIP3_TAG, readZipRow, zip3Key, type Zip3File } from "./zip3.ts";

/**
 * An answer lives at the address of what it is made from, so one never changes: the CDN keeps it for a year, shares it between its nodes, and a deploy
 * does not empty it (Netlify-Cache-ID replaces the deploy's own cache id). A browser asks again each time and is told "same" by the ETag.
 */
const IMMUTABLE = { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable", "Netlify-Cache-ID": "reader-answer" } as const;
/** An answer made for a day that has passed (the lane is behind) is not kept long; it is replaced as soon as the ZIP's file is. */
const BEHIND = { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=60" } as const;
/** A link to an address that has moved is sent on to the current one. It is kept briefly, so a stale link never assembles anything. */
const MOVED = { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=30" } as const;
const NOT_THERE = { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, max-age=10" } as const;
/** The file of a prefix moves with its keys: copies live a minute, are served while they refresh, and are cleared by tag when the lane writes it. */
const ZIP3 = { "Cache-Control": "public, max-age=30, stale-while-revalidate=300", "Netlify-CDN-Cache-Control": "public, durable, max-age=60, stale-while-revalidate=86400" } as const;
/** What the answer shows depends on the meeting settings, so their publication clears answers by this tag. */
const ANSWER_TAG = "reader-settings";

const KEY = /^[0-9a-f]{8,16}$/, VERSION = /^[0-9a-f]{32}$/;
const missing = () => new Response(null, { status: 404, headers: NOT_THERE });
const moved = (to: string) => new Response(null, { status: 307, headers: { ...MOVED, Location: to } });
const failed = (error: unknown) => { console.error("READER_ANSWER_FAILED", error); return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); };

/** The JSON, compressed for the reader that asked: brotli, gzip, or as it is. It is made once for the CDN, so it is made small. */
function encoded(request: Request, value: unknown, headers: Record<string, string>): Response {
  const json = Buffer.from(JSON.stringify(value)), accepts = request.headers.get("accept-encoding") ?? "";
  const base = { ...headers, "Content-Type": "application/json; charset=utf-8", "Vary": "Accept-Encoding" };
  if (/\bbr\b/.test(accepts)) return new Response(new Uint8Array(brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } })), { headers: { ...base, "Content-Encoding": "br" } });
  if (/\bgzip\b/.test(accepts)) return new Response(new Uint8Array(gzipSync(json, { level: 6 })), { headers: { ...base, "Content-Encoding": "gzip" } });
  return new Response(json, { headers: base });
}

/** `/api/answer/<zip>/<key>`: one ZIP's answer. The store is read and nothing else. */
export async function serveAnswer(request: Request, zip: string, key: string, store: ReaderArtifactStore | null = resolveReaderArtifactStore(), assemble: typeof assembleAnswer = assembleAnswer): Promise<Response> {
  if (!/^\d{5}$/.test(zip) || !KEY.test(key) || !store) return missing();
  try {
    const row = await readZipRow(store, zip);
    if (!row || !row.point) return missing();
    if (row.key !== key) return moved(answerPath(zip, row.key));
    const day = row.day ?? easternDay(new Date());
    return encoded(request, await assemble(store, zip, row, day), { ...(day === easternDay(new Date()) ? IMMUTABLE : BEHIND), "ETag": `"${key}"`, "Netlify-Cache-Tag": ANSWER_TAG });
  } catch (error) { return failed(error); }
}

/** `/api/answer/board/<bodyId>/<fileVersion>`: what a board's answer leaves with the board. */
export async function serveBoard(request: Request, bodyId: string, version: string, store: ReaderArtifactStore | null = resolveReaderArtifactStore(), assemble: typeof assembleBoard = assembleBoard): Promise<Response> {
  if (!VERSION.test(version) || !store) return missing();
  try {
    const file = await getFile<PlaceFile>(store, version);
    if (!file || file.kind !== "body" || !file.state) return missing();
    const index = (await openPlaceFiles(store).index(file.state))?.index, current = index && boardVersion(index, bodyId);
    if (!current || current.id !== file.id) return missing();
    if (current.version !== version) return moved(boardPath(current.id, current.version));
    return encoded(request, await assemble(store, file, version), { ...IMMUTABLE, "ETag": `"${version}"` });
  } catch (error) { return failed(error); }
}

/** `/api/reader/zip3/<NNN>.json`: the ZIPs of a prefix, where they are and the address of each one's answer. */
export async function serveZip3(prefix: string, store: ReaderArtifactStore | null = resolveReaderArtifactStore()): Promise<Response> {
  if (!/^\d{3}$/.test(prefix) || !store) return missing();
  try {
    const file = await store.readJsonPointer<Zip3File>(zip3Key(prefix));
    return file ? Response.json(file.value, { headers: { ...ZIP3, "Netlify-Cache-Tag": READER_ZIP3_TAG(prefix) } }) : missing();
  } catch (error) { return failed(error); }
}
