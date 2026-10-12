import type { GeographyType } from "../census-geography/contract.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { containersOfCode, type CodeSlice, type Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ZipDivisionEntry } from "./zip-division-index.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { censusDistrictEdgeSlice } from "../census-geography/district-edge.ts";
import { currentRepresentationSelection, type GeographySelection } from "../census-geography/selection.ts";
import { representationDivision, selectedRepresentationContainers } from "./representation-geography.ts";
import { REPRESENTATION_GEOGRAPHY_TYPES } from "../census-geography/district-edge.ts";

const TYPES: readonly GeographyType[] = REPRESENTATION_GEOGRAPHY_TYPES;
const cached = new Map<string, { at: number; read: Promise<Slice<CodeSlice>>; good?: Slice<CodeSlice> & { kind: "HELD" } }>();

/** Qualified district descriptions travel with the same ZIP membership read.
 * A registration boundary file need not contain a newly published district. */
export async function publishedDivisionsForZip(zip: string, selection: GeographySelection = currentRepresentationSelection()): Promise<import("../registry/types.ts").Division[]> {
  const slice = await publishedZipDistricts(zip);
  if (slice.kind !== "HELD" || !slice.value.known) return [];
  const out: import("../registry/types.ts").Division[] = [];
  for (const container of selectedRepresentationContainers(slice.value, selection)) {
    if (!container.overlaps?.some(overlap => overlap.zcta5 === zip)) continue;
    const scope = slice.value.scopes.find(scope => scope.type === container.ref.type && scope.version === container.ref.version);
    const division = scope && representationDivision(container.ref, scope);
    if (division) out.push(division);
  }
  return out;
}

/** Only a unique published plan of a district type can supersede the old
 * sampled index. Multiple vintages remain unresolved instead of being mixed.
 * Local governments continue to use their held, independently joined data. */
export function withCensusDistricts(entry: ZipDivisionEntry, slice: Slice<CodeSlice>, zip: string, selection: GeographySelection = currentRepresentationSelection()): ZipDivisionEntry {
  const ids = new Set(entry.ids), partial = new Set(entry.partial);
  // The legacy sample has no plan applicability. Neither a ballot nor current
  // representation can silently fall back to its district assignments.
  for (const id of ids) if (/\/(?:cd|sldu|sldl|aiannh):[^/]+$/.test(id)) { ids.delete(id); partial.delete(id); }
  if (slice.kind !== "HELD" || !slice.value.known) return { ...entry, ids: [...ids], partial: [...partial] };
  for (const container of selectedRepresentationContainers(slice.value, selection)) {
      const id = censusWorkDivision(container.ref);
      const overlap = container.overlaps?.find(o => o.zcta5 === zip);
      if (!id || !overlap) continue;
      ids.add(id);
      if (overlap.whole) partial.delete(id); else partial.add(id);
  }
  return { ...entry, ids: [...ids], partial: [...partial] };
}

/** Same promoted Census slice Admin reads; bounded and shared for a ZIP.
 * Failed updates preserve the original index and are eligible to retry. */
export async function publishedZipDistricts(zip: string): Promise<Slice<CodeSlice>> {
  const edge = currentReaderAuthorityEdge();
  if (edge?.censusDistricts) return censusDistrictEdgeSlice(edge.censusDistricts.value, edge.censusDistricts.versionId, zip);
  // An older/unavailable serving copy retains the existing index's uncertainty.
  // Adding Census certainty must not add a cold database dependency to an
  // otherwise complete edge request (including the strictly edge-only warmer).
  if (edge) return { kind: "UNREAD", detail: "Census districts are not available on this reader edge" };
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
