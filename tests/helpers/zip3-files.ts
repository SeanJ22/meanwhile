import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { answerKey, type PlaceIndex } from "../../lib/reader/place-index.ts";
import { zipEntry } from "../../lib/reader/zip-files.ts";
import { zip3Key, type Zip3File, type ZipRow } from "../../lib/reader/zip3.ts";
import { easternDay } from "../../lib/reader/answer.ts";

/** The ZIP files of the prefixes the given state indexes list, as the lane writes them: each ZIP's row, with its answer's key made from the key it has in every state it touches. */
export function zip3Files(indexes: ReadonlyMap<string, PlaceIndex>, now: Date): Map<string, Zip3File> {
  const out = new Map<string, Record<string, ZipRow>>();
  for (const [state, index] of indexes) for (const zip of Object.keys(index.zips)) {
    const entry = zipEntry(index, zip)!, states = entry.states ?? [state];
    if (states[0] !== state) continue;
    const row = index.zips[zip]!, keys = states.map(code => indexes.get(code)?.zips[zip]?.[7]);
    if (keys.some(key => key === undefined)) continue;
    const point = row[0] === null || row[1] === null ? null : [row[1], row[0]] as const;
    const prefix = zip.slice(0, 3), held = out.get(prefix) ?? {};
    held[zip] = { states, point, key: answerKey(keys as string[], now), day: easternDay(now), ids: entry.ids, partial: entry.partial, fringe: entry.fringe ?? [], districts: entry.districts };
    out.set(prefix, held);
  }
  return new Map([...out].map(([prefix, zips]) => [prefix, { v: 1 as const, zips }]));
}

/** Writes the files, replacing what is there the way the lane does: the pointer moves with the etag it read. */
export async function writeZip3Files(store: ReaderArtifactStore, files: ReadonlyMap<string, Zip3File>): Promise<void> {
  for (const [prefix, file] of files) {
    const held = await store.readJsonPointer(zip3Key(prefix));
    await store.writeJsonPointer(zip3Key(prefix), file, held?.etag ?? null);
  }
}
