import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { ZctaCentroid } from "../geo/zcta-core.ts";
import type { PlaceEntry } from "../place-map/reader.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { serverReaderValue } from "./memory.ts";
import type { PlacePackage } from "./place-types.ts";

/**
 * One file per ZIP in the reader artifact store, packed with brotli: everything a typed ZIP needs, so a reader's visit
 * reads one file and never the database. It holds the three finished answers' inputs as the routes build them.
 *
 * A state's government registry is the same in every ZIP of the state, so it is filed once under its own fingerprint and each ZIP
 * file names it. Only the divisions, which differ by ZIP, stay in the ZIP's file. The national routing record is the same in every ZIP
 * of the country: it is filed once, and one small pointer names the current one, so a change to it writes two files, not one per ZIP.
 */
const FORMAT = 1;
export const zipAnswerKey = (zip: string): string => `reader/zip/${zip}.json.br`;
const partKey = (hash: string): string => `reader/zip-part/${hash}.json.br`;

/** A state's answer for the ZIP, exactly as `/api/reader/state?state=S&zip=Z` returns it. */
export interface ZipStateAnswer { readonly version: string; readonly body: Record<string, unknown> }

export interface ZipAnswer {
  readonly zip: string;
  /** The body `/api/location/zip` returns. */
  readonly location: Record<string, unknown>;
  /** By state code, for each state the ZIP lies in. */
  readonly states: Readonly<Record<string, ZipStateAnswer>>;
  /** The ZIP's place entry and display point. */
  readonly place: PlaceEntry;
  readonly point: ZctaCentroid;
  /** The territory boards at the point, so a request naming a different point is answered the long way. */
  readonly territoryBodyIds: readonly string[];
  /** The saved pages the package was composed from, which name the answer's cache tags. */
  readonly pageIds: readonly string[];
  /** What `/api/meetings` reads of the saved pages; the meetings themselves are composed against the clock at request time. */
  readonly package: PlacePackage;
}

/** The ZIP file as stored: the registry is replaced by its divisions and the fingerprint of the rest, and the national routing is left to its pointer. */
type StoredAnswer = Omit<ZipAnswer, "package"> & { readonly package: Omit<PlacePackage, "registry" | "everydayRouting"> & { readonly registry: { readonly divisions: unknown; readonly shared: string } | null } };

export interface PackedZipAnswer {
  /** Two builds of a ZIP with the same print are the same answer. */
  readonly print: string;
  readonly file: Uint8Array;
  /** The state's registry, filed under its fingerprint; null when the ZIP holds none. */
  readonly part: { readonly key: string; readonly bytes: Uint8Array } | null;
}

const brotli = (text: string): Uint8Array => brotliCompressSync(Buffer.from(text), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: text.length } });
const fingerprint = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);

export function packZipAnswer(answer: ZipAnswer): PackedZipAnswer {
  const { everydayRouting: _routing, ...held } = answer.package, registry = held.registry;
  let part: PackedZipAnswer["part"] = null;
  let shared: StoredAnswer["package"]["registry"] = null;
  if (registry) {
    // Everything of the registry but its divisions; the divisions' place keeps its key order when they are put back.
    const text = JSON.stringify({ ...registry, registry: { ...registry.registry, divisions: [] } }), hash = fingerprint(text);
    part = { key: partKey(hash), bytes: brotli(text) };
    shared = { divisions: registry.registry.divisions, shared: hash };
  }
  const stored: StoredAnswer = { ...answer, package: { ...held, registry: shared } };
  const text = JSON.stringify(stored), print = fingerprint(text);
  return { print, file: brotli(`{"v":${FORMAT},"print":"${print}","answer":${text}}`), part };
}

/** Parts are fingerprinted and never change, so a server keeps their packed bytes and decodes a fresh copy for each answer. */
const heldParts = serverReaderValue("zip-answer-parts", () => new Map<string, Uint8Array>());
const HELD_PARTS = 24;

async function readPart<T>(store: ReaderArtifactStore, hash: string): Promise<T | null> {
  let bytes = heldParts.get(hash);
  if (!bytes) {
    bytes = await store.readBytes(partKey(hash), { strong: true }) ?? undefined;
    if (!bytes) return null;
    heldParts.set(hash, bytes);
    for (const oldest of heldParts.keys()) { if (heldParts.size <= HELD_PARTS) break; heldParts.delete(oldest); }
  }
  return JSON.parse(brotliDecompressSync(bytes).toString("utf8")) as T;
}

const NATIONAL_KEY = "reader/zip-national.json";
/** How long a server keeps the national pointer it read: a change to a national record reaches every ZIP within this. */
const NATIONAL_MEMORY_MS = 60_000;
interface NationalPointer { readonly everydayRouting: string | null }
const heldNational = serverReaderValue("zip-answer-national", () => ({ at: 0, hash: undefined as string | null | undefined }));

/** The hash of the national routing record the pointer names (null: none is recorded), or undefined when no pointer is filed yet. */
async function nationalHash(store: ReaderArtifactStore, now = Date.now()): Promise<string | null | undefined> {
  if (heldNational.hash !== undefined && now - heldNational.at < NATIONAL_MEMORY_MS) return heldNational.hash;
  const pointer = await store.readJsonPointer<NationalPointer>(NATIONAL_KEY);
  heldNational.hash = pointer ? pointer.value.everydayRouting : undefined;
  heldNational.at = now;
  return heldNational.hash;
}

/** Files the national routing record once and points to it; nothing is written when the pointer already names it. True when the pointer moved. */
export async function publishNational(store: ReaderArtifactStore, routing: EverydayRoutingProjection | null): Promise<boolean> {
  const text = routing ? JSON.stringify(routing) : null, hash = text ? fingerprint(text) : null;
  const held = await store.readJsonPointer<NationalPointer>(NATIONAL_KEY);
  if (held && held.value.everydayRouting === hash) return false;
  // The record is filed before the pointer that names it.
  if (text && hash) await store.writeBytes(partKey(hash), brotli(text));
  const result = await store.writeJsonPointer<NationalPointer>(NATIONAL_KEY, { everydayRouting: hash }, held?.etag ?? null);
  if (!result.modified) throw new Error("ZIP_NATIONAL_POINTER_BUSY");
  heldNational.hash = hash; heldNational.at = Date.now();
  return true;
}

export async function unpackZipAnswer(store: ReaderArtifactStore, bytes: Uint8Array, zip: string): Promise<(ZipAnswer & { readonly print: string }) | null> {
  const file = JSON.parse(brotliDecompressSync(bytes).toString("utf8")) as { v?: number; print?: string; answer?: StoredAnswer };
  const answer = file.answer;
  if (file.v !== FORMAT || typeof file.print !== "string" || answer?.zip !== zip) return null;
  const national = await nationalHash(store);
  if (national === undefined) return null;
  const everydayRouting = national ? await readPart<EverydayRoutingProjection>(store, national) : null;
  if (national && !everydayRouting) return null;
  const held = answer.package.registry;
  let registry: RegistryRuntimeReadModel | null = null;
  if (held) {
    const shared = await readPart<RegistryRuntimeReadModel>(store, held.shared);
    if (!shared) return null;
    registry = { ...shared, registry: { ...shared.registry, divisions: held.divisions } } as RegistryRuntimeReadModel;
  }
  return { ...answer, package: { ...answer.package, registry, everydayRouting }, print: file.print };
}

/**
 * The published answer for a ZIP, or null when none is held (or the store cannot be read), so the caller answers from the database as before.
 * Read strongly: a republished ZIP is purged from the CDN right after its write, and the next fetch must find the new file.
 */
export async function readZipAnswer(zip: string, store: ReaderArtifactStore | null = resolveReaderArtifactStore()): Promise<(ZipAnswer & { readonly print: string }) | null> {
  if (!store || !/^\d{5}$/.test(zip)) return null;
  try {
    const bytes = await store.readBytes(zipAnswerKey(zip), { strong: true });
    return bytes ? await unpackZipAnswer(store, bytes, zip) : null;
  } catch { return null; }
}
