import type { GeographyType } from "../census-geography/contract.ts";
import { zipNeedsAddress } from "./postal.ts";
import { censusWorkDivision, districtFamilyKey } from "../census-geography/division-id.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { containersOfCode, type CodeSlice, type Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { ZipDivisionEntry } from "./zip-division-index.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { currentRepresentationSelection, selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";

const TYPES: readonly GeographyType[] = ["congressional_district", "state_leg_upper", "state_leg_lower"];
const cached = new Map<string, { at: number; read: Promise<Slice<CodeSlice>>; good?: Slice<CodeSlice> & { kind: "HELD" } }>();

/** Qualified district descriptions travel with the same ZIP membership read.
 * A registration boundary file need not contain a newly published district. */
export async function publishedDivisionsForZip(zip: string, selection: GeographySelection = currentRepresentationSelection()): Promise<import("../registry/types.ts").Division[]> {
  if (zipNeedsAddress(zip)) return [];
  return divisionsFromZipDistricts(zip, await publishedZipDistricts(zip), selection);
}

/** District descriptions from the same state package that established ZIP membership. */
export function divisionsFromZipDistricts(zip: string, slice: Slice<CodeSlice>, selection: GeographySelection = currentRepresentationSelection()): import("../registry/types.ts").Division[] {
  if (zipNeedsAddress(zip) || slice.kind !== "HELD" || !slice.value.known) return [];
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
  return censusDistrictsForZips(slice, selection)(entry, zip);
}

/** Index a selected plan once when qualifying every ZIP in a state's package. */
export function censusDistrictsForZips(slice: Slice<CodeSlice>, selection: GeographySelection = currentRepresentationSelection()): (entry: ZipDivisionEntry, zip: string) => ZipDivisionEntry {
  if (slice.kind !== "HELD" || !slice.value.known) return entry => entry;
  const byZip = new Map<string, Map<string, { id: string; whole: boolean }[]>>();
  const versions = slice.value.scopes.map(scope => ({ ...scope, key: scope.version }));
  for (const type of TYPES) {
    const states = new Set(slice.value.containers.filter(c => c.ref.type === type).map(c => c.ref.stateAbbr));
    for (const state of states) {
      const selected = selectGeographyVersion(versions, type, selection, state);
      if (!selected) continue;
      for (const container of slice.value.containers) {
        if (container.ref.type !== type || container.ref.stateAbbr !== state || container.ref.version !== selected.key) continue;
        const id = censusWorkDivision(container.ref), family = id && districtFamilyKey(id);
        if (!id || !family) continue;
        const seen = new Set<string>();
        for (const overlap of container.overlaps ?? []) {
          if (seen.has(overlap.zcta5)) continue;
          seen.add(overlap.zcta5);
          const groups = byZip.get(overlap.zcta5) ?? new Map<string, { id: string; whole: boolean }[]>();
          const members = groups.get(family) ?? [];
          members.push({ id, whole: overlap.whole }); groups.set(family, members); byZip.set(overlap.zcta5, groups);
        }
      }
    }
  }
  return (entry, zip) => {
    const ids = new Set(entry.ids), partial = new Set(entry.partial), qualifiedDistricts: string[] = [];
    for (const [family, found] of byZip.get(zip) ?? []) {
      for (const id of ids) if (districtFamilyKey(id) === family) { ids.delete(id); partial.delete(id); }
      qualifiedDistricts.push(family);
      for (const { id, whole } of found) { ids.add(id); if (whole) partial.delete(id); else partial.add(id); }
    }
    return { ...entry, ids: [...ids], partial: [...partial], qualifiedDistricts };
  };
}

/** Same promoted Census slice Admin reads; bounded and shared for a ZIP.
 * Failed updates preserve the original index and are eligible to retry. */
export async function publishedZipDistricts(zip: string): Promise<Slice<CodeSlice>> {
  const edge = currentReaderAuthorityEdge();
  const served = await edge?.censusDistricts?.slice(zip);
  if (served && served.kind === "HELD") return served;
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
