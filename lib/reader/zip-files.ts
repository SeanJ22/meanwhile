import { districtFamilyKey } from "../census-geography/division-id.ts";
import type { PlaceEntry } from "../place-map/reader.ts";
import { lengthen, type ZipFile } from "./place-index.ts";
import type { PlaceFile, PlaceFileSource } from "./place-file.ts";
import { stateAnswerOf } from "./state-response.ts";
import { composeState, stateDivisionId, type StateShare, type StateWide } from "./state-share.ts";

/** A ZIP's places as the place map gives them, read from its row in a state's ZIP file; null when the file lists no such ZIP. */
export function zipEntry(file: ZipFile, base: string, zip: string): (PlaceEntry & { readonly districts: readonly string[]; readonly key: string }) | null {
  const row = file.zips[zip];
  if (!row) return null;
  const ids = (list: readonly number[]) => list.map(n => lengthen(base, file.places[n]![0])), elsewhere = (row[8] as (readonly string[])[] | undefined) ?? [[], [], []];
  const whole = (own: readonly number[], more: readonly string[]) => [...ids(own), ...more].sort();
  const all = whole(row[3], elsewhere[0]!), fringe = whole(row[5], elsewhere[2]!);
  return { ids: all, partial: whole(row[4], elsewhere[1]!), samples: 0, states: row[2], districts: ids(row[6]), key: row[7],
    qualifiedDistricts: [...new Set(all.flatMap(id => districtFamilyKey(id) ?? []))], ...(fringe.length ? { fringe } : {}) };
}

/** The state's answer for a ZIP, made from the state's statewide part and the shares in the files of the ZIP's divisions. */
export async function stateAnswerFromFiles(source: PlaceFileSource, state: string, zip: string, entry: PlaceEntry & { readonly districts: readonly string[]; readonly key?: string }) {
  const { districts, key: _key, ...placed } = entry, ids = [...new Set([stateDivisionId(state), ...entry.ids, ...districts])];
  const files = (await Promise.all(ids.map(id => source.file(id)))).filter((file): file is PlaceFile => file !== null);
  const wide = files.find(file => file.id === stateDivisionId(state))?.wide as StateWide | undefined;
  if (!wide) throw new Error(`STATE_FILE_MISSING:${state}`);
  return stateAnswerOf(composeState(wide, files.flatMap(file => file.share ? [file.share as StateShare] : [])), state, zip, placed);
}
