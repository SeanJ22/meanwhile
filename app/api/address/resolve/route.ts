import {
  zipThisAddressResolvesTo,
  locateAddressInZip,
  sampleStreetPoints,
  type CensusPoint,
} from "@/lib/geo/census-geocoder";
import {
  resolveAddress,
  type AddressResolution,
  type Sample,
} from "@/lib/geo/address-resolution";
import { divisionsForCensusGeographies } from "@/lib/registry/server";
import { censusVintageFor } from "@/lib/geo/census-geographies";
import { currentRepresentationSelection, type GeographySelection } from "@/lib/census-geography/selection";
import { addressContestScopeFor } from "@/lib/ballot/address-scope";
import { publishedZipDistricts } from "@/lib/geo/zip-census-districts";
import { excludedRepresentationAtPoints, requestRepresentationGeographyReader, supplementPointDivisions } from "@/lib/geo/representation-geography";
import { readReaderManifest, readerAuthorityEdge } from "@/lib/meetings/edge-serving";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { postalArea, zipNeedsAddress } from "@/lib/geo/postal";
import { lookupZcta } from "@/lib/geo/zcta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

function bad(): Response {
  return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
}

export async function POST(request: Request) {
  let zip = "";
  let street = "";
  let houseNumber = "";
  let postalEntry = false;
  let selection: GeographySelection = currentRepresentationSelection();
  try {
    const body = (await request.json()) as {
      zip?: unknown;
      street?: unknown;
      houseNumber?: unknown;
      postalEntry?: unknown;
      selection?: GeographySelection;
    };
    zip = typeof body.zip === "string" ? body.zip.trim() : "";
    street = typeof body.street === "string" ? body.street.trim() : "";
    houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
    postalEntry = body.postalEntry === true;
    if (body.selection) {
      if (!["representation", "election"].includes(body.selection.purpose) || !/^\d{4}-\d{2}-\d{2}$/.test(body.selection.asOf) ||
          body.selection.purpose === "election" && !/^\d{4}-\d{2}-\d{2}$/.test(body.selection.electionDate ?? "")) return bad();
      selection = body.selection;
    }
  } catch {
    return bad();
  }

  // Validity checks, not rate limits — closed shapes, real bounds, and never
  // behind a flag. A 60-character street is a paste accident or an attack.
  if (!/^\d{5}$/.test(zip)) return bad();
  if (street.length < 3 || street.length > 120) return bad();
  if (houseNumber.length > 12) return bad();
  const omitZip = postalEntry && (zipNeedsAddress(zip) || !lookupZcta(zip));
  const area = postalArea(zip);
  const queryStreet = omitZip && !street.includes(",") && area?.place && area.state
    ? `${street}, ${area.place}, ${area.state}` : street;

  const authority = readReaderManifest().then(manifest => manifest
    ? readerAuthorityEdge(manifest, undefined, ["registry-runtime", "census-districts"])
    : null).catch(() => null);
  const geographyRead = authority.then(edge => withReaderAuthorityEdge(edge, () => publishedZipDistricts(zip)));
  const points: CensusPoint[] = [];
  const vintage = censusVintageFor(selection);
  if (houseNumber.length > 0) {
    const point = await locateAddressInZip(houseNumber, queryStreet, zip, { omitZip, vintage });
    if (point) points.push(point);
  } else {
    points.push(...(await sampleStreetPoints(queryStreet, zip, { omitZip, vintage })));
  }

  if (points.length === 0) {

    const elsewhere =
      houseNumber.length > 0
        ? await zipThisAddressResolvesTo(houseNumber, street, zip)
        : null;
    const failed: AddressResolution = {
      status: "FAILED",
      reason: "NOT_FOUND",
      ...(elsewhere ? { resolvesInZip: elsewhere } : {}),
    };
    return Response.json({ ok: true, resolution: failed, contestIds: [] }, { headers: NO_STORE });
  }

  return withReaderAuthorityEdge(await authority, async () => {
    const geography = await geographyRead;
    const states = new Set(geography.kind === "HELD"
      ? [...new Set(geography.value.containers.map(container => container.ref.stateAbbr))]
      : []);
    const bases = await Promise.all(points.map(p => divisionsForCensusGeographies(p.geographies ?? {}, selection, vintage, p.geographyVintages ?? {})));
    for (const base of bases) for (const division of base) states.add(division.state);
    const coordinates: [number, number][] = points.map(point => [point.lng, point.lat]);
    const representationRead = requestRepresentationGeographyReader(undefined, { points: coordinates, selection });
    const held = await Promise.all([...states].map(representationRead));
    const samples: Sample[] = await Promise.all(points.map(async (p, index) => {
      const divisions = await supplementPointDivisions(p.lat, p.lng, bases[index], undefined, representationRead, [...states], selection);
      return divisions.map(d => ({ ocdId: d.ocdId, divisionType: d.divisionType, label: d.label }));
    }));
    const resolution = resolveAddress(samples);
    const excludedDivisionIds = held.flatMap(slice => slice.kind === "HELD" ? excludedRepresentationAtPoints(coordinates, slice.value, selection) : []);
    const confirmed = resolution.status === "FAILED" ? []
      : resolution.levels.filter(level => level.certain).flatMap(level => level.divisionIds);
    const point = resolution.status === "RESOLVED" ? {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    } : null;
    const ballot = selection.purpose === "election"
      ? await addressContestScopeFor(confirmed, undefined, selection)
      : { contestIds: [], ballotStatus: "NOT_RECORDED" };
    return Response.json({ ok: true, resolution, ...ballot, point, excludedDivisionIds }, { headers: NO_STORE });
  });
}
