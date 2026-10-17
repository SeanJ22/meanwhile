import type { GeographyType } from "../census-geography/contract.ts";
import { zipNeedsAddress } from "./postal.ts";
import { censusWorkDivision, districtFamilyKey } from "../census-geography/division-id.ts";
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
  const versions = slice.value.scopes.map(scope => ({ ...scope, key: scope.version }));
  for (const type of TYPES) {
    for (const container of slice.value.containers) {
      if (container.ref.type !== type || !container.overlaps?.some(overlap => overlap.zcta5 === zip)) continue;
      const selected = selectGeographyVersion(versions, type, selection, container.ref.stateAbbr);
      if (!selected || container.ref.version !== selected.key) continue;
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

/** A selected plan replaces only the state/family for which it supplies ZIP
 * rows. Other held membership remains available for its own plan qualification. */
export function withCensusDistricts(entry: ZipDivisionEntry, slice: Slice<CodeSlice>, zip: string, selection: GeographySelection = currentRepresentationSelection()): ZipDivisionEntry {
  if (slice.kind !== "HELD" || !slice.value.known) return entry;
  const ids = new Set(entry.ids), partial = new Set(entry.partial);
  const qualifiedDistricts = new Set<string>();
  const versions = slice.value.scopes.map(scope => ({ ...scope, key: scope.version }));
  for (const type of TYPES) {
    const states = new Set(slice.value.containers.filter(c => c.ref.type === type).map(c => c.ref.stateAbbr));
    for (const state of states) {
      const selected = selectGeographyVersion(versions, type, selection, state);
      if (!selected) continue;
      const found = slice.value.containers.filter(c => c.ref.type === type && c.ref.stateAbbr === state && c.ref.version === selected.key)
        .flatMap(container => {
          const id = censusWorkDivision(container.ref), overlap = container.overlaps?.find(o => o.zcta5 === zip);
          return id && overlap ? [{ id, overlap }] : [];
        });
      if (!found.length) continue;
      const family = districtFamilyKey(found[0].id)!;
      for (const id of ids) if (districtFamilyKey(id) === family) { ids.delete(id); partial.delete(id); }
      qualifiedDistricts.add(family);
      for (const { id, overlap } of found) {
        ids.add(id);
        if (overlap.whole) partial.delete(id); else partial.add(id);
      }
    }
  }
  return { ...entry, ids: [...ids], partial: [...partial], qualifiedDistricts: [...qualifiedDistricts] };
}

/** Same promoted Census slice Admin reads; bounded and shared for a ZIP.
 * Failed updates preserve the original index and are eligible to retry. */
export async function publishedZipDistricts(zip: string): Promise<Slice<CodeSlice>> {
  const edge = currentReaderAuthorityEdge();
  if (edge?.censusDistricts) return censusDistrictEdgeSlice(edge.censusDistricts.value, edge.censusDistricts.versionId, zip);
  // The strictly edge-only warmer never opens the database; any other request reads it until the pointer is published.
  if (edge?.edgeOnly) return { kind: "UNREAD", detail: "Census districts are not available on this reader edge" };
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
