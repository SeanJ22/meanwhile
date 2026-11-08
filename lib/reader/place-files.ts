import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import { fileKey, packFile, unpackFile, fileHash, withMore, type PlaceAgendas, type PlaceFile, type PlaceFileSource, type PlaceHistory } from "./place-file.ts";
import { serverReaderValue } from "./memory.ts";
import { lengthen, type BoardsIndex, type IndexPointer, type MapIndex } from "./place-index.ts";
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
  const layouts = new Map<string, Promise<{ at: Map<string, string>; boards: Map<string, string>; aliases: Readonly<Record<string, string>>; national: NationalFile | null }>>();
  const layout = (state: string) => {
    let held = layouts.get(state);
    if (!held) layouts.set(state, held = (async () => {
      const found = await pointer(state);
      if (!found) throw new Error(`PLACE_INDEX_MISSING:${state}`);
      const map = (await keptFile<MapIndex>(store, found.map))!, boards = (await keptFile<BoardsIndex>(store, found.boards))!;
      const named = new Map(boards.boards.map(row => [lengthen(boards.base, row[0]), row[2]] as const));
      const at = new Map([...map.places.map(row => [lengthen(map.base, row[0]), row.at(-1) as string] as const), ...named]);
      const aliases = (at.has(stateDivisionId(state)) ? await keptFile<PlaceFile>(store, at.get(stateDivisionId(state))!) : null)?.aliases ?? {};
      return { at, boards: named, aliases, national: await keptFile<NationalFile>(store, found.national) };
    })());
    return held;
  };
  const source = async (state: string): Promise<PlaceFileSource> => {
    const { at, aliases, national } = await layout(state);
    return {
      has: id => at.has(id),
      file: async (id, more) => {
        const name = at.get(id), found = name ? await keptFile<PlaceFile>(store, name) : null;
        if (!found || !more) return found;
        // History is its own file; the agenda of the brief variants is another, and the history file holds its own variants' agenda.
        const [history, agendas] = await Promise.all([more.history && found.history ? keptFile<PlaceHistory>(store, found.history) : null,
          more.agenda && !more.history && found.agenda ? keptFile<PlaceAgendas>(store, found.agenda) : null]);
        return history || agendas ? withMore(found, history, agendas) : found;
      },
      canonicalBody: id => aliases[id] ?? id,
      routing: async () => national?.routing ?? null,
    };
  };
  /** A board of the state by id, or by an id it was folded into; null when it has no file. */
  const board = async (state: string, bodyId: string): Promise<{ readonly id: string; readonly version: string } | null> => {
    const { boards, aliases } = await layout(state), id = aliases[bodyId] ?? bodyId, version = boards.get(id);
    return version ? { id, version } : null;
  };
  return { pointer, source, board };
}
