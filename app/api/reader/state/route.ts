import { zipNeedsAddress } from "@/lib/geo/postal";
import { censusDistrictsForZips } from "@/lib/geo/zip-census-districts";
import { censusWorkDivision } from "@/lib/census-geography/division-id";
import { selectGeographyVersion, currentRepresentationSelection } from "@/lib/census-geography/selection";
import type { Division } from "@/lib/registry/types";
import { readStateZipPlaces, stateForZip } from "@/lib/reader/national";
import { stateCoverage } from "@/lib/reader/coverage";
import { readStatePackage } from "@/lib/reader/state";
import { requireRegistryState } from "@/lib/civic-data/state-scopes";
import { withReaderRoute } from "@/lib/db/reader-route";
import { stateMemberDirectories } from "@/lib/reader/member-directories";
import { readerCacheHeaders } from "@/lib/reader/cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const zip = params.get("zip");
  if (zip !== null && !/^\d{5}$/.test(zip)) return Response.json({ error: "A five digit ZIP is required" }, { status: 400 });
  const input = params.get("state") ?? stateForZip(params.get("zip") ?? "") ?? "";
  let state: string;
  try { state = requireRegistryState(input.replace(/^US-/i, "")); }
  catch { return Response.json({ error: "A US state or territory is required" }, { status: 400 }); }
  try {
    const [value, places] = await withReaderRoute("/api/reader/state", () => Promise.all([readStatePackage(state), readStateZipPlaces(state)]));
    const versions = value.districts.kind === "HELD" ? value.districts.value.scopes.map(scope => ({ ...scope, key: scope.version })) : [];
    const selection = currentRepresentationSelection();
    const selected = new Map((["congressional_district", "state_leg_upper", "state_leg_lower"] as const).map(type => [type, selectGeographyVersion(versions, type, selection, state)]));
    const extraDivisions: Division[] = value.districts.kind === "HELD" ? value.districts.value.containers.flatMap(container => {
      const scope = selected.get(container.ref.type as "congressional_district" | "state_leg_upper" | "state_leg_lower");
      const id = censusWorkDivision(container.ref);
      if (!id || !scope?.sourceUrls?.[0] || !scope.observedAt || container.ref.version !== scope.key) return [];
      return [{ ocdId: id, divisionType: container.ref.type === "congressional_district" ? "cd" : container.ref.type === "state_leg_upper" ? "sldu" : "sldl", tier: container.ref.type === "congressional_district" ? "national" : "state", state, label: container.ref.label, parentOcdId: id.slice(0, id.lastIndexOf("/")), lsad: null, funcstat: null, classfp: null, geoid: container.ref.geoid, canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED", sourceDataset: "CENSUS_RELATIONSHIPS", provenance: { sourceUrl: scope.sourceUrls[0], sourceOrg: "U.S. Census Bureau", collectedAt: scope.observedAt, verifiedAt: null } }];
    }) : [];
    const districtSlice = value.districts.kind === "HELD" ? { ...value.districts, value: { ...value.districts.value, known: true } } : value.districts;
    const qualify = censusDistrictsForZips(districtSlice);
    const ownState = new RegExp(`/(?:state|territory|district):${state.toLowerCase()}(?:/|$)`);
    const zipPlaces: Record<string, import("@/lib/geo/zip-division-index").ZipDivisionEntry> = {};
    const selectedPlaces = zip ? [[zip, places.get(zip)] as const] : places;
    for (const [code, entry] of selectedPlaces) {
      if (!entry) continue;
      const qualified = zipNeedsAddress(code) ? entry : qualify(entry, code);
      const ids = qualified.ids.filter(id => ownState.test(id));
      const ownIds = new Set(ids);
      zipPlaces[code] = { ...qualified, ids, partial: qualified.partial.filter(id => ownIds.has(id)) };
    }
    const ids = zip ? zipPlaces[zip]?.ids ?? []
      : [...new Set([...value.registry.registry.divisions.map(division => division.ocdId), ...extraDivisions.map(division => division.ocdId)])];
    const divisionsById = new Map(value.registry.registry.divisions.map(division => [division.ocdId, division]));
    const statewide = { ...value, registry: { ...value.registry, bodyRosters: [],
      registry: { ...value.registry.registry, bodies: value.registry.registry.bodies.filter(body => body.ocdId && ["national", "state"].includes(divisionsById.get(body.ocdId)?.tier ?? "")) } } };
    const summary = stateCoverage(statewide, ids, 0, 0, [], [], extraDivisions);
    const coverage = { ...summary, governments: [], bodies: summary.bodies.filter(body => body.tier !== "local") };
    return Response.json({ state, version: value.version, coverage, zipPlaces, boundaryUrl: value.boundaryUrl, directory: zip ? null : value.federal?.directory ?? null,
      ...(zip ? { zip } : { memberDirectories: stateMemberDirectories(value.people, value.memberOffices) }) }, { headers: {
      ...readerCacheHeaders({ states: [state], places: ids }),
      "Netlify-Vary": "query=state|zip",
      "ETag": `"${value.version}:${zip ?? state}"`,
    } });
  } catch {
    return Response.json({ error: "The state's information could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
