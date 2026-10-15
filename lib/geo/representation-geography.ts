import type { GeographyRef } from "../census-geography/contract.ts";
import { censusWorkDivision } from "../census-geography/division-id.ts";
import { currentRepresentationSelection, selectGeographyVersion, type GeographySelection } from "../census-geography/selection.ts";
import type { ContainerSlice, GeographySlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import { stateContainers } from "../control-plane/admin-view/promoted-slices.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { contains, type GeoFeature } from "../registry/resolve.ts";
import type { Division } from "../registry/types.ts";
import { tribalSeatReferencesFor } from "../officials/tribal-seats.ts";
import { hydrateBoundaryGeometries } from "../census-geography/boundary-artifacts.ts";

const SUPPLEMENTAL_TYPES = ["overlay_district", "aiannh"] as const;

export type RepresentationGeographyReader = (state: string) => Promise<Slice<GeographySlice>>;

/** Select plans separately for each state's chamber. Supplemental areas never replace the partition. */
export function selectedRepresentationContainers(slice: GeographySlice, selection: GeographySelection = currentRepresentationSelection()): readonly ContainerSlice[] {
  const families = new Map<string, ContainerSlice[]>();
  for (const container of slice.containers) {
    const ref = container.ref;
    if (ref.type === "aiannh" && ref.representation !== "tribal") continue;
    const family = `${ref.type}|${ref.stateAbbr}|${ref.chamber ?? ""}`;
    const rows = families.get(family) ?? [];
    rows.push(container);
    families.set(family, rows);
  }
  const selected: ContainerSlice[] = [];
  for (const containers of families.values()) {
    const ref = containers[0].ref;
    const version = selectGeographyVersion(slice.scopes.filter(scope => (!scope.stateFips || scope.stateFips === ref.stateFips) && (!scope.chamber || scope.chamber === ref.chamber)).map(scope => ({ ...scope, key: scope.version })), ref.type, selection, ref.stateAbbr);
    if (version) selected.push(...containers.filter(container => container.ref.version === version.key));
  }
  return selected;
}

/** Metadata and polygons come from the same promoted version as ZIP membership. */
export function representationDivision(ref: GeographyRef, scope: GeographySlice["scopes"][number]): Division | null {
  const id = censusWorkDivision(ref);
  const sourceUrls = ref.sourceUrls ?? scope.sourceUrls;
  if (!id || !sourceUrls?.length || !scope.observedAt) return null;
  const tribal = ref.type === "aiannh" ? tribalSeatReferencesFor(ref.stateAbbr).find(row => row.aiannhAreaIds.some(id => id === ref.geoid || id.slice(0, 4) === ref.geoid)) : undefined;
  if (ref.type === "aiannh" && !tribal) return null;
  const divisionType = ref.type === "congressional_district" ? "cd" : ref.type === "state_leg_upper" || ref.type === "overlay_district" && ref.chamber === "upper" ? "sldu" : ref.type === "aiannh" ? "aiannh" : "sldl";
  return { ocdId: id, divisionType, tier: divisionType === "cd" ? "national" : "state", state: ref.stateAbbr,
    label: ref.label, parentOcdId: id.slice(0, id.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null,
    geoid: ref.geoid, canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED",
    sourceDataset: ref.type === "overlay_district" ? "OFFICIAL_OVERLAY_DISTRICTS" : ref.type === "aiannh" ? "TIGER_AIANNH" : "CENSUS_RELATIONSHIPS", representation: ref.representation, nation: tribal?.nation, chamber: ref.chamber,
    sourceUrls, provenance: { sourceUrl: sourceUrls[0], sourceOrg: ref.sourceOrg ?? "U.S. Census Bureau", collectedAt: scope.observedAt, verifiedAt: null } };
}

/** State-bounded read, served by the existing immutable district edge on reader requests. */
export async function publishedRepresentationGeography(state: string): Promise<Slice<GeographySlice>> {
  const edge = currentReaderAuthorityEdge();
  if (edge?.censusDistricts) {
    const slice = await edge.censusDistricts.loadState(state.toUpperCase());
    return slice.kind === "HELD" ? { ...slice, value: { ...slice.value,
      containers: slice.value.containers.filter(container => SUPPLEMENTAL_TYPES.includes(container.ref.type as typeof SUPPLEMENTAL_TYPES[number])) } } : slice;
  }
  if (edge) return { kind: "UNREAD", detail: "Representation boundaries are unavailable on this reader edge" };
  return stateContainers(state, SUPPLEMENTAL_TYPES, false, readerQuery(1000));
}

/** All street samples in a request share one state read and one published version. */
export function requestRepresentationGeographyReader(read: RepresentationGeographyReader = publishedRepresentationGeography,
  area?: { readonly points: readonly [number, number][]; readonly selection?: GeographySelection }): RepresentationGeographyReader {
  const states = new Map<string, Promise<Slice<GeographySlice>>>();
  return state => {
    const postal = state.toUpperCase();
    let held = states.get(postal);
    if (!held) {
      held = read(postal).then(async slice => {
        if (slice.kind !== "HELD" || !area) return slice;
        try {
          const selected = { ...slice.value, containers: selectedRepresentationContainers(slice.value, area.selection) };
          return { ...slice, value: await hydrateBoundaryGeometries(selected, "accurate", undefined, { points: area.points }) };
        } catch {
          return { kind: "UNREAD", detail: "Published representation polygons could not be read" } as const;
        }
      });
      states.set(postal, held);
    }
    return held;
  };
}

export function representationDivisionsAt(point: [number, number], slice: GeographySlice, selection?: GeographySelection): Division[] {
  const hits: Division[] = [];
  for (const container of selectedRepresentationContainers(slice, selection)) {
    const geometry = container.ref.geometry;
    if (!geometry || !contains(point, { properties: { ocdId: "", label: "" }, geometry } as GeoFeature)) continue;
    const scope = slice.scopes.find(scope => scope.type === container.ref.type && scope.version === container.ref.version &&
      (!scope.stateFips || scope.stateFips === container.ref.stateFips) && (!scope.chamber || scope.chamber === container.ref.chamber));
    const division = scope && representationDivision(container.ref, scope);
    if (division) hits.push(division);
  }
  return hits;
}

/** Source bounds or hydrated polygons must place every sample outside an excluded area. */
export function excludedRepresentationAtPoints(points: readonly [number, number][], slice: GeographySlice, selection?: GeographySelection): string[] {
  if (!points.length) return [];
  return selectedRepresentationContainers(slice, selection).flatMap(container => {
    if (!["overlay_district", "aiannh"].includes(container.ref.type)) return [];
    const id = censusWorkDivision(container.ref);
    if (!id) return [];
    const bounds = container.ref.geometryRef?.bounds;
    if (bounds && points.every(([lng, lat]) => lng < bounds[0] || lat < bounds[1] || lng > bounds[2] || lat > bounds[3])) return [id];
    if (!container.ref.geometry) return [];
    const feature = { properties: { ocdId: "", label: "" }, geometry: container.ref.geometry } as GeoFeature;
    return points.every(point => !contains(point, feature)) ? [id] : [];
  });
}

export async function supplementPointDivisions(lat: number, lng: number, base: readonly Division[], state?: string, read?: RepresentationGeographyReader, additionalStates: readonly string[] = [], selection?: GeographySelection): Promise<Division[]> {
  const states = new Set(state ? [state] : base.map(division => division.state).filter((value): value is string => !!value));
  for (const additional of additionalStates) states.add(additional);
  const reader = read ?? requestRepresentationGeographyReader(undefined, { points: [[lng, lat]], selection });
  const reads = await Promise.all([...states].map(reader));
  const additional = reads.flatMap(slice => slice.kind === "HELD" ? representationDivisionsAt([lng, lat], slice.value, selection) : []);
  return [...new Map([...base, ...additional].map(division => [division.ocdId, division])).values()];
}
