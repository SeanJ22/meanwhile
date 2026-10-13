import type { GeographyType } from "../census-geography/contract.ts";
import { zipNeedsAddress } from "./postal.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { containersOfCode, type CodeSlice, type Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ZipDivisionEntry } from "./zip-division-index.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { censusDistrictEdgeSlice } from "../census-geography/district-edge.ts";
import { currentRepresentationSelection, selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";

const TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower"];
const cached = new Map<string, { at: number; read: Promise<Slice<CodeSlice>>; good?: Slice<CodeSlice> & { kind: "HELD" } }>();

/** Qualified district descriptions travel with the same ZIP membership read.
 * A registration boundary file need not contain a newly published district. */
export async function publishedDivisionsForZip(zip: string, selection: GeographySelection = currentRepresentationSelection()): Promise<import("../registry/types.ts").Division[]> {
  if (zipNeedsAddress(zip)) return [];
  const slice = await publishedZipDistricts(zip);
  if (slice.kind !== "HELD" || !slice.value.known) return [];
  const out: import("../registry/types.ts").Division[] = [];
  for (const type of TYPES) {
    const selected = selectGeographyVersion(slice.value.scopes.map(scope => ({ ...scope, key: scope.version })), type, selection);
    if (!selected) continue;
    for (const container of slice.value.containers) {
      if (container.ref.type !== type || container.ref.version !== selected.key || !container.overlaps?.some(overlap => overlap.zcta5 === zip)) continue;
      const id = censusWorkDivision(container.ref);
      if (!id || !selected.sourceUrls?.[0] || !selected.observedAt) continue;
      out.push({ ocdId: id, divisionType: type === "congressional_district" ? "cd" : type === "state_leg_upper" ? "sldu" : "sldl",
        tier: type === "congressional_district" ? "national" : "state", state: container.ref.stateAbbr,
        label: container.ref.label, parentOcdId: id.slice(0, id.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null,
        geoid: container.ref.geoid, canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED", sourceDataset: "CENSUS_RELATIONSHIPS",
        provenance: { sourceUrl: selected.sourceUrls[0], sourceOrg: "U.S. Census Bureau", collectedAt: selected.observedAt, verifiedAt: null } });
    }
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
  for (const id of ids) if (/\/(?:cd|sldu|sldl):[^/]+$/.test(id)) { ids.delete(id); partial.delete(id); }
  if (slice.kind !== "HELD" || !slice.value.known) return { ...entry, ids: [...ids], partial: [...partial] };
  for (const type of TYPES) {
    const selected = selectGeographyVersion(slice.value.scopes.map(scope => ({ ...scope, key: scope.version })), type, selection);
    if (!selected) continue;
    const found = slice.value.containers.filter(c => c.ref.type === type && c.ref.version === selected.key);
    // A ZIP with no rows for this family does not prove complete empty coverage.
    if (!found.length) continue;
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
