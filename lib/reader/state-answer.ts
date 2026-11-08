import { censusWorkDivision } from "../census-geography/division-id.ts";
import { selectGeographyVersion, currentRepresentationSelection } from "../census-geography/selection.ts";
import type { Division } from "../registry/types.ts";
import type { PlaceEntry } from "../place-map/reader.ts";
import { stateCoverage } from "./coverage.ts";
import type { StateOfficeContact } from "../reference/state-offices.ts";
import type { ReaderStatePackage } from "./state.ts";
import { stateMemberDirectories, zipMemberDirectories } from "./member-directories.ts";

/** The state answer composed from one held state package and the ZIP's place entry; it reads nothing. */
export function composeStateAnswer(state: string, zip: string | null, indexed: PlaceEntry | null, value: ReaderStatePackage, stateOffices: readonly StateOfficeContact[]) {
  const versions = value.districts.kind === "HELD" ? value.districts.value.scopes.map(scope => ({ ...scope, key: scope.version })) : [];
  const selection = currentRepresentationSelection();
  const selected = new Map((["congressional_district", "state_leg_upper", "state_leg_lower"] as const).map(type => [type, selectGeographyVersion(versions, type, selection, state)]));
  const extraDivisions: Division[] = [...value.localDivisions ?? [], ...(value.districts.kind === "HELD" ? value.districts.value.containers.flatMap<Division>(container => {
    const scope = selected.get(container.ref.type as "congressional_district" | "state_leg_upper" | "state_leg_lower");
    const id = censusWorkDivision(container.ref);
    if (!id || !scope?.sourceUrls?.[0] || !scope.observedAt || container.ref.version !== scope.key) return [];
    return [{ ocdId: id, divisionType: container.ref.type === "congressional_district" ? "cd" : container.ref.type === "state_leg_upper" ? "sldu" : "sldl", tier: container.ref.type === "congressional_district" ? "national" : "state", state, label: container.ref.label, parentOcdId: id.slice(0, id.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null, geoid: container.ref.geoid, canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED", sourceDataset: "CENSUS_RELATIONSHIPS", provenance: { sourceUrl: scope.sourceUrls[0], sourceOrg: "U.S. Census Bureau", collectedAt: scope.observedAt, verifiedAt: null } }];
  }) : [])];
  const ownState = new RegExp(`/(?:state|territory|district):${state.toLowerCase()}(?:/|$)`);
  // Only a ZIP's own places are sent; a state answer without a ZIP names no ZIP.
  const own = indexed?.ids.filter(id => ownState.test(id)) ?? [];
  const zipPlaces: Record<string, PlaceEntry> = zip && indexed ? { [zip]: { ...indexed, ids: own, partial: indexed.partial.filter(id => own.includes(id)) } } : {};
  const ids = zip ? own
    : [...new Set([...value.registry.registry.divisions.map(division => division.ocdId), ...extraDivisions.map(division => division.ocdId)])];
  const divisionsById = new Map(value.registry.registry.divisions.map(division => [division.ocdId, division]));
  const statewide = { ...value, registry: { ...value.registry, bodyRosters: [],
    registry: { ...value.registry.registry, bodies: value.registry.registry.bodies.filter(body => body.ocdId && ["national", "state"].includes(divisionsById.get(body.ocdId)?.tier ?? "")) } } };
  const summary = stateCoverage({ ...statewide, stateOffices: stateOffices }, ids, 0, 0, [], [], extraDivisions);
  const coverage = { ...summary, governments: [], bodies: summary.bodies.filter(body => body.tier !== "local") };
  return { state, version: value.version, coverage, zipPlaces, boundaryUrl: value.boundaryUrl, directory: zip ? null : value.federal?.directory ?? null,
    memberDirectories: zip ? zipMemberDirectories(value.people, value.memberOffices, value.federal,
      [...coverage.seats.flatMap(seat => seat.representatives), ...coverage.senators, ...coverage.statewideExecutives])
      : stateMemberDirectories(value.people, value.memberOffices), ...(zip ? { zip } : {}) };
}
