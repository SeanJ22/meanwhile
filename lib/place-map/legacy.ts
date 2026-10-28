import type { PlaceEntry } from "./reader.ts";

/** Decode acquired ZIP seed rows for the place-map import. Reader requests never load these shards. */
export interface LegacyZipShard {
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
  readonly partial: Readonly<Record<string, readonly number[]>>;
  readonly zipSamples: Readonly<Record<string, number>>;
  /** 2020 residents of each `zips` division inside the ZIP, index-aligned; -1 where the blocks do not measure it. */
  readonly residents?: Readonly<Record<string, readonly number[]>>;
  readonly zipResidents?: Readonly<Record<string, number>>;
}


/** A division home to a smaller share of a ZIP's residents than this is named for the ZIP, never shown as governing it. */
export const ZIP_RESIDENT_SHARE_SHOWN = 0.05;
/** At this share a division holds the whole ZIP; below it the ZIP is split. */
const WHOLE_ZIP_SHARE = 0.995;
const STATEWIDE = /^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?$/;

export function legacyZipEntry(shard: LegacyZipShard, zip: string): PlaceEntry | null {
  const refs = shard.zips[zip];
  if (refs === undefined) return null;
  const counts = shard.residents?.[zip], total = shard.zipResidents?.[zip] ?? 0;
  const ids: string[] = [], partial: string[] = [], fringe: string[] = [];
  refs.forEach((ref, k) => {
    const id = shard.divisions[ref];
    if (STATEWIDE.test(id)) { ids.push(id); return; }
    const residents = counts && total > 0 ? counts[k] ?? -1 : -1;
    if (residents >= 0 && residents / total < ZIP_RESIDENT_SHARE_SHOWN) { fringe.push(id); return; }
    ids.push(id);
    if (residents < 0 || residents / total < WHOLE_ZIP_SHARE) partial.push(id);
  });
  return { ids, partial, samples: shard.zipSamples[zip] ?? 0, ...(fringe.length ? { fringe } : {}) };
}

