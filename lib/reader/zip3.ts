import type { ReaderArtifactStore } from "../meetings/edge-store.ts";

/**
 * Where a ZIP is, read from the file of its first three digits. A row names the ZIP's states (the first is the one the reader sees), its point as [lng, lat],
 * the address of its assembled answer (`key`, which moves when any file the answer is made from moves and each US Eastern day), the US Eastern day the key
 * was made for, and the places the place map gives it: its divisions, the ones it only partly lies in, the ones it only names, and the Census districts that
 * reach into it.
 */
export interface ZipRow {
  readonly states: readonly string[];
  readonly point: readonly [number, number] | null;
  readonly key: string;
  readonly day?: string;
  readonly ids: readonly string[];
  readonly partial: readonly string[];
  readonly fringe: readonly string[];
  readonly districts: readonly string[];
  /** What the postal service says of the ZIP, as /api/location/zip gave it: its type, place and county. */
  readonly postal?: unknown;
}
export interface Zip3File { readonly v: 1; readonly zips: Readonly<Record<string, ZipRow>> }

export const zip3Key = (prefix: string): string => `reader/zip3/${prefix}.json`;
export const READER_ZIP3_TAG = (prefix: string): string => `reader-zip3:${prefix}`;

/** A ZIP's row, or null when its prefix has no file or the file lists no such ZIP. Reads the store and nothing else; given a map, each prefix is read once for it. */
export async function readZipRow(store: ReaderArtifactStore, zip: string, files?: Map<string, Promise<ZipRow | null>>): Promise<ZipRow | null> {
  const read = () => store.readJsonPointer<Zip3File>(zip3Key(zip.slice(0, 3)));
  if (!files) return (await read())?.value.zips[zip] ?? null;
  let held = files.get(zip.slice(0, 3)) as Promise<{ value: Zip3File } | null> | undefined;
  if (!held) files.set(zip.slice(0, 3), held = read() as never);
  return (await held)?.value.zips[zip] ?? null;
}
