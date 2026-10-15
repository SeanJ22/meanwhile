import { readReaderManifest, ensureReaderAuthorityEdge, READER_MAP_AUTHORITY_FAMILIES, READER_MANIFEST_CACHE_TAG } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { divisionsAt } from "@/lib/registry/server";
import { requestRepresentationGeographyReader, selectedRepresentationContainers, representationDivision } from "@/lib/geo/representation-geography";
import { hydrateBoundaryGeometries } from "@/lib/census-geography/boundary-artifacts";
import { FIPS_TO_STATE } from "@/lib/ocd/fips";
import { numeric, numericInRange } from "@/lib/api/params";

export const runtime = "nodejs";
const variation = { "Netlify-Vary": "query" };

/** The visible state's independently published overlapping representation areas. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = numericInRange(url.searchParams, "lat", -90, 90, "refuse");
  const longitude = numericInRange(url.searchParams, "lng", -180, 180, "refuse");
  const requestedState = url.searchParams.get("state")?.toUpperCase();
  const parts = url.searchParams.get("bounds")?.split(",") ?? [];
  if (!latitude.ok || !longitude.ok || parts.length !== 4 ||
      requestedState && !Object.values(FIPS_TO_STATE).some(row => row.postal === requestedState)) {
    return Response.json({ ok: false }, { status: 400, headers: { ...variation, "Cache-Control": "no-store" } });
  }
  const bounds = parts.flatMap((raw, index) => {
    const params = new URLSearchParams({ bounds: raw });
    const read = index % 2 === 0 ? numeric(params, "bounds", "refuse") : numericInRange(params, "bounds", -90, 90, "refuse");
    return read.ok ? [read.value] : [];
  });
  if (bounds.length !== 4 || bounds[1] > bounds[3]) {
    return Response.json({ ok: false }, { status: 400, headers: { ...variation, "Cache-Control": "no-store" } });
  }
  const lat = latitude.value, lng = longitude.value;
  const manifest = await readReaderManifest().catch(() => null);
  if (manifest?.authorityArtifacts) {
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null);
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const read = requestRepresentationGeographyReader();
  const states = new Set(requestedState ? [requestedState] : (await divisionsAt(lat, lng, read)).map(row => row.state).filter((state): state is string => !!state));
  const slices = await Promise.all([...states].map(async state => {
    const slice = await read(state);
    if (slice.kind !== "HELD") return slice;
    try {
      const selected = { ...slice.value, containers: selectedRepresentationContainers(slice.value) };
      return { ...slice, value: await hydrateBoundaryGeometries(selected, "display", undefined, { bounds }) };
    } catch {
      return { kind: "UNREAD", detail: "Published display polygons could not be read" } as const;
    }
  }));
  if (slices.some(slice => slice.kind !== "HELD")) {
    return Response.json({ ok: false, status: "NOT_YET_PUBLISHED" }, { status: 503, headers: { ...variation, "Cache-Control": "no-store" } });
  }
  const features = slices.flatMap(slice => {
    if (slice.kind !== "HELD") return [];
    return selectedRepresentationContainers(slice.value).flatMap(container => {
      const geometry = container.ref.geometry;
      const scope = slice.value.scopes.find(scope => scope.type === container.ref.type && scope.version === container.ref.version);
      const division = scope && representationDivision(container.ref, scope);
      if (!geometry || !division) return [];
      return [{ type: "Feature", id: division.ocdId, geometry, properties: { ocdId: division.ocdId, label: division.label, state: division.state,
        boundaryType: division.divisionType === "sldu" ? "state-senate" : "state-house", representation: division.representation, nation: division.nation,
        sourceUrls: division.sourceUrls, sourceOrg: division.provenance.sourceOrg, collectedAt: division.provenance.collectedAt } }];
    });
  });
  return Response.json({ ok: true, type: "FeatureCollection", features }, { headers: {
    ...variation,
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=3600",
    "Netlify-Cache-Tag": READER_MANIFEST_CACHE_TAG, "Cache-Control": "public, max-age=0, must-revalidate",
  } });
}
