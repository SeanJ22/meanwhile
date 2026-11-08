import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { fileKey, packFile, unpackFile, fileHash, type PlaceFile, type PlaceFileSource } from "./place-file.ts";
import { serverReaderValue } from "./memory.ts";
import { lengthen, type PlaceIndex } from "./place-index.ts";

/** The one mutable file of a state: it names the state's current index and the current national file. Every other file is named by its hash and never changes. */
export const indexPointerKey = (state: string): string => `reader/index/${state}.json`;
export const READER_INDEX_TAG = (state: string): string => `reader-index:${state}`;
export interface IndexPointer { readonly index: string; readonly national: string }

/** The national file: what no place owns. */
export interface NationalFile { readonly v: 1; readonly president: unknown; readonly routing: EverydayRoutingProjection | null }

/** Files a value under its hash unless it is already filed. */
export async function putFile(store: ReaderArtifactStore, value: unknown): Promise<{ readonly name: string; readonly bytes: number; readonly written: boolean }> {
  const name = fileHash(value), bytes = packFile(value);
  return { name, bytes: bytes.byteLength, written: await store.putIfAbsent(fileKey(name), bytes) };
}

export async function getFile<T>(store: ReaderArtifactStore, name: string, strong = false): Promise<T | null> {
  const bytes = await store.readBytes(fileKey(name), { strong });
  return bytes ? unpackFile<T>(bytes) : null;
}

/** Files are immutable, so a server keeps the ones it read by name for the ZIPs that follow: at most this many, and at most this many stored bytes. */
const KEPT_FILES = 256, KEPT_BYTES = 48 * 1024 * 1024;
const kept = serverReaderValue("place-files-kept", () => new Map<string, { readonly value: unknown; readonly bytes: number }>());

/** A file by name from this server's memory, or from the store and then kept. */
async function keptFile<T>(store: ReaderArtifactStore, name: string): Promise<T | null> {
  const have = kept.get(name);
  if (have) { kept.delete(name); kept.set(name, have); return have.value as T; }
  const bytes = await store.readBytes(fileKey(name));
  if (!bytes) return null;
  const value = unpackFile<T>(bytes);
  kept.set(name, { value, bytes: bytes.byteLength });
  let total = 0;
  for (const entry of kept.values()) total += entry.bytes;
  for (const oldest of kept.keys()) { if (kept.size <= KEPT_FILES && total <= KEPT_BYTES) break; total -= kept.get(oldest)!.bytes; kept.delete(oldest); }
  return value;
}

/** The files of a store, read through the states' pointers: what a reader that has only the store has. */
export function openPlaceFiles(store: ReaderArtifactStore) {
  const indexes = new Map<string, Promise<{ pointer: IndexPointer; index: PlaceIndex; etag: string | null } | null>>();
  const national = new Map<string, Promise<NationalFile | null>>();
  const index = (state: string) => {
    let held = indexes.get(state);
    if (!held) indexes.set(state, held = (async () => {
      const pointer = await store.readJsonPointer<IndexPointer>(indexPointerKey(state));
      const found = pointer && await getFile<PlaceIndex>(store, pointer.value.index);
      return pointer && found ? { pointer: pointer.value, index: found, etag: pointer.etag } : null;
    })());
    return held;
  };
  const source = async (state: string): Promise<PlaceFileSource> => {
    const held = await index(state);
    if (!held) throw new Error(`PLACE_INDEX_MISSING:${state}`);
    const at = new Map(held.index.places.map(row => [lengthen(held.index.base, row[0]), row[4]]));
    if (!national.has(held.pointer.national)) national.set(held.pointer.national, keptFile<NationalFile>(store, held.pointer.national));
    return {
      has: id => at.has(id),
      file: async id => { const name = at.get(id); return name ? keptFile<PlaceFile>(store, name) : null; },
      canonicalBody: id => held.index.aliases[id] ?? id,
      routing: async () => (await national.get(held.pointer.national))?.routing ?? null,
    };
  };
  return { index, source };
}
