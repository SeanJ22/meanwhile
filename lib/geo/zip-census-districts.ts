import type { GeographyType } from "../census-geography/contract.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { containersOfCode, type CodeSlice, type Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ZipDivisionEntry } from "./zip-division-index.ts";

const TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower"];
const cached = new Map<string, { at: number; read: Promise<Slice<CodeSlice>>; good?: Slice<CodeSlice> & { kind: "HELD" } }>();

/** Only a unique published plan of a district type can supersede the old
 * sampled index. Multiple vintages remain unresolved instead of being mixed.
 * Local governments continue to use their held, independently joined data. */
export function withCensusDistricts(entry: ZipDivisionEntry, slice: Slice<CodeSlice>, zip: string): ZipDivisionEntry {
  if (slice.kind !== "HELD" || !slice.value.known) return entry;
  const ids = new Set(entry.ids), partial = new Set(entry.partial);
  for (const type of TYPES) {
    const versions = new Set(slice.value.scopes.filter(s => s.type === type).map(s => s.version));
    if (versions.size !== 1) continue;
    const found = slice.value.containers.filter(c => c.ref.type === type && versions.has(c.ref.version));
    for (const container of found) {
      const id = censusWorkDivision(container.ref);
      const overlap = container.overlaps?.find(o => o.zcta5 === zip);
      if (!id || !overlap) continue;
      ids.add(id);
      if (overlap.whole) partial.delete(id); else partial.add(id);
    }
  }
  return { ...entry, ids: [...ids], partial: [...partial] };
}

/** Same promoted Census slice Admin reads; bounded and shared for a ZIP.
 * Failed updates preserve the original index and are eligible to retry. */
export async function publishedZipDistricts(zip: string): Promise<Slice<CodeSlice>> {
  const query = readerQuery(1000);
  if (!query) return { kind: "UNREAD", detail: "No reader store is configured" };
  const held = cached.get(zip);
  if (held && Date.now() - held.at < 300_000) return held.read;
  const read = containersOfCode(zip, TYPES, query).catch((): Slice<CodeSlice> => ({ kind: "UNREAD", detail: "Published Census district read failed" }));
  cached.set(zip, { at: Date.now(), read, good: held?.good });
  if (cached.size > 100) cached.delete(cached.keys().next().value!);
  const result = await read;
  if (result.kind === "HELD") cached.set(zip, { at: Date.now(), read: Promise.resolve(result), good: result });
  else if (held?.good) {
    // Keep the exact previous published version, and retry after one minute.
    cached.set(zip, { at: Date.now() - 240_000, read: Promise.resolve(held.good), good: held.good });
    return held.good;
  } else cached.delete(zip);
  return result;
}
