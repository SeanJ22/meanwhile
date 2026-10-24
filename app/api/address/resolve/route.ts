import { readerRoute } from "@/lib/api/reader-route";
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
import { placesAtPoint } from "@/lib/place-map/read";
import { placeMapQuery, placeDivisionType } from "@/lib/place-map/reader";
import { censusVintageFor } from "@/lib/geo/census-geographies";
import { currentRepresentationSelection, type GeographySelection } from "@/lib/census-geography/selection";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { postalArea, zipNeedsAddress } from "@/lib/geo/postal";
import { readZipLocation } from "@/lib/place-map/locations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

function bad(): Response {
  return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
}

/** Contest ids for a confirmed division set — the ballot page's narrowing. */
async function contestIdsFor(ocdIds: readonly string[], selection: GeographySelection): Promise<string[]> {
  if (ocdIds.length === 0 || selection.purpose !== "election") return [];
  const ids = new Set<string>();
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    const candidate = source.normalize(await source.fetch());
    if (candidate.election.date !== selection.electionDate) continue;
    for (const contest of [...candidate.contests, ...candidate.heldContests ?? []]) ids.add(contest.id);
  }
  return [...ids];
}

export const POST = readerRoute("/api/address/resolve", async function POST(request: Request) {
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
  const omitZip = postalEntry && (zipNeedsAddress(zip) || !await readZipLocation(zip));
  const area = postalArea(zip);
  const queryStreet = omitZip && !street.includes(",") && area?.place && area.state
    ? `${street}, ${area.place}, ${area.state}` : street;

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

  const samples: Sample[] = [];
  for (const p of points) {
    const { memberships } = await placesAtPoint(placeMapQuery(), [p.lng, p.lat], selection);
    samples.push(
      memberships.map(row => ({ ocdId: row.placeId, divisionType: placeDivisionType(row.layer,row.placeId), label: row.name })),
    );
  }

  const resolution = resolveAddress(samples);

  const confirmed =
    resolution.status === "FAILED"
      ? []
      : resolution.levels.filter((l) => l.certain).flatMap((l) => l.divisionIds);

  /* The point comes back only when the answer is unambiguous: a street midpoint, never a house, never stored. */
  const point =
    resolution.status === "RESOLVED" && points.length > 0
      ? {
          lat: points.reduce((sum, q) => sum + q.lat, 0) / points.length,
          lng: points.reduce((sum, q) => sum + q.lng, 0) / points.length,
        }
      : null;

  return Response.json(
    { ok: true, resolution, contestIds: await contestIdsFor(confirmed, selection).catch(() => []), point },
    { headers: NO_STORE },
  );
});
