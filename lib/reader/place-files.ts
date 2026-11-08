import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { fileKey, packFile, unpackFile, fileHash, type PlaceFile, type PlaceFileSource } from "./place-file.ts";
import { serverReaderValue } from "./memory.ts";
import { lengthen, type BoardsIndex, type IndexPointer, type MapIndex, type ZipFile } from "./place-index.ts";
import { stateDivisionId } from "./state-share.ts";

export const indexPointerKey = (state: string): string => `reader/index/${state}.json`;
export const READER_INDEX_TAG = (state: string): string => `reader-index:${state}`;

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
  const pointers = new Map<string, Promise<IndexPointer | null>>();
  const pointer = (state: string) => {
    let held = pointers.get(state);
    if (!held) pointers.set(state, held = store.readJsonPointer<IndexPointer>(indexPointerKey(state)).then(read => read?.value ?? null));
    return held;
  };
  /** One prefix's ZIP file. */
  const zipFile = async (state: string, zip: string): Promise<ZipFile | null> => {
    const name = (await pointer(state))?.zip3[zip.slice(0, 3)];
    return name ? keptFile<ZipFile>(store, name) : null;
  };
  const source = async (state: string): Promise<PlaceFileSource> => {
    const held = await pointer(state);
    if (!held) throw new Error(`PLACE_INDEX_MISSING:${state}`);
    const map = (await keptFile<MapIndex>(store, held.map))!;
    const boards = (await keptFile<BoardsIndex>(store, held.boards))!;
    const at = new Map([...map.places.map(row => [lengthen(map.base, row[0]), row.at(-1) as string] as const), ...boards.boards.map(row => [lengthen(boards.base, row[0]), row[2]] as const)]);
    const national = await keptFile<NationalFile>(store, held.national);
    const aliases = (at.has(stateDivisionId(state)) ? await keptFile<PlaceFile>(store, at.get(stateDivisionId(state))!) : null)?.aliases ?? {};
    return {
      has: id => at.has(id),
      file: async id => { const name = at.get(id); return name ? keptFile<PlaceFile>(store, name) : null; },
      canonicalBody: id => aliases[id] ?? id,
      routing: async () => national?.routing ?? null,
    };
  };
  return { pointer, zipFile, source };
}
