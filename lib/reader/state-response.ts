import { censusWorkDivision } from "../census-geography/division-id";
import { selectGeographyVersion, currentRepresentationSelection } from "../census-geography/selection";
import type { Division } from "../registry/types";
import { readStateZipPlaces, readZipPlace, withPlaceMapReads, type PlaceEntry } from "../place-map/reader";
import { stateCoverage } from "../reader/coverage";
import { readStatePackage } from "../reader/state";
import { requireRegistryState } from "../civic-data/state-scopes";
import { withReaderRoute } from "../db/reader-route";
import { stateMemberDirectories, zipMemberDirectories } from "../reader/member-directories";
import { readerCacheHeaders } from "../reader/cache";

export function readerStateResponse(request: Request) {
  return withPlaceMapReads(() => stateResponse(request));
}

async function stateResponse(request: Request) {
  const params = new URL(request.url).searchParams;
  const zip = params.get("zip");
  if (zip !== null && !/^\d{5}$/.test(zip)) return Response.json({ error: "A five digit ZIP is required" }, { status: 400 });
  let indexed: PlaceEntry | null;
  try { indexed = zip ? await readZipPlace(zip) : null; }
  catch { return Response.json({ error: "The place map could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const input = params.get("state") ?? indexed?.states?.[0] ?? "";
  let state: string;
  try { state = requireRegistryState(input.replace(/^US-/i, "")); }
  catch { return Response.json({ error: "A US state or territory is required" }, { status: 400 }); }
  try {
    const divisionIds = indexed?.ids ?? [];
    const [value, places] = await withReaderRoute("/api/reader/state", () => Promise.all([readStatePackage(state, divisionIds, zip ?? undefined),
      zip ? Promise.resolve(new Map(indexed ? [[zip, indexed]] : [])) : readStateZipPlaces(state)]));
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
    const zipPlaces: Record<string, PlaceEntry> = {};
    const selectedPlaces = zip ? [[zip, places.get(zip)] as const] : places;
    for (const [code, entry] of selectedPlaces) {
      if (!entry) continue;
      const ids = entry.ids.filter(id => ownState.test(id));
      const ownIds = new Set(ids);
      zipPlaces[code] = { ...entry, ids, partial: entry.partial.filter(id => ownIds.has(id)) };
    }
    const ids = zip ? zipPlaces[zip]?.ids ?? []
      : [...new Set([...value.registry.registry.divisions.map(division => division.ocdId), ...extraDivisions.map(division => division.ocdId)])];
    const divisionsById = new Map(value.registry.registry.divisions.map(division => [division.ocdId, division]));
    const statewide = { ...value, registry: { ...value.registry, bodyRosters: [],
      registry: { ...value.registry.registry, bodies: value.registry.registry.bodies.filter(body => body.ocdId && ["national", "state"].includes(divisionsById.get(body.ocdId)?.tier ?? "")) } } };
    const summary = stateCoverage(statewide, ids, 0, 0, [], [], extraDivisions);
    const coverage = { ...summary, governments: [], bodies: summary.bodies.filter(body => body.tier !== "local") };
    return Response.json({ state, version: value.version, coverage, zipPlaces, boundaryUrl: value.boundaryUrl, directory: zip ? null : value.federal?.directory ?? null,
      memberDirectories: zip ? zipMemberDirectories(value.people, value.memberOffices, value.federal,
        [...coverage.seats.flatMap(seat => seat.representatives), ...coverage.senators, ...coverage.statewideExecutives])
        : stateMemberDirectories(value.people, value.memberOffices), ...(zip ? { zip } : {}) }, { headers: {
      ...readerCacheHeaders({ states: [state], places: zip ? ids : [] }),
      "Netlify-Vary": "query=state|zip",
      "ETag": `"${value.version}:${zip ?? state}"`,
    } });
  } catch {
    return Response.json({ error: "The state's information could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
