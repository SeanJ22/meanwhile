import {
  zipThisAddressResolvesTo,
  locateAddressInZip,
  sampleStreetPoints,
} from "@/lib/geo/census-geocoder";
import {
  resolveAddress,
  type AddressResolution,
  type Sample,
} from "@/lib/geo/address-resolution";
import { divisionsAt } from "@/lib/registry/server";
import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";

/**
 * Takes a street and a ZIP; returns the jurisdictions the reader is confirmed to be in, level by level, and
 * the levels the street crosses. Nothing is stored or logged, and the house number is used for one geocode
 * and dropped. `no-store`: the answer is per reader and must never sit in a shared cache.
 *
 *   RESOLVED   every level the street touches has one answer
 *   AMBIGUOUS  one or more levels are split; the confirmed levels stay confirmed
 *   FAILED     we could not place the street
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

function bad(): Response {
  return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
}

/** Contest ids for a confirmed division set — the ballot page's narrowing. */
async function contestIdsFor(ocdIds: readonly string[]): Promise<string[]> {
  if (ocdIds.length === 0) return [];
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    const candidate = source.normalize(await source.fetch());
    const hit = contestsForDivisions(candidate, [...ocdIds]);
    if (hit.contests.length > 0 || hit.absences.length > 0) {
      return hit.contests.map((c) => c.id);
    }
  }
  return [];
}

export async function POST(request: Request) {
  let zip = "";
  let street = "";
  let houseNumber = "";
  try {
    const body = (await request.json()) as {
      zip?: unknown;
      street?: unknown;
      houseNumber?: unknown;
    };
    zip = typeof body.zip === "string" ? body.zip.trim() : "";
    street = typeof body.street === "string" ? body.street.trim() : "";
    houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
  } catch {
    return bad();
  }

  // Validity checks, not rate limits — closed shapes, real bounds, and never
  // behind a flag. A 60-character street is a paste accident or an attack.
  if (!/^\d{5}$/.test(zip)) return bad();
  if (street.length < 3 || street.length > 120) return bad();
  if (houseNumber.length > 12) return bad();

  /*
   * With a house number there is ONE point and nothing to average, so every
   * level is certain by construction. Without one, the street is sampled at
   * several low numbers and the divisions are compared.
   */
  const points: { lat: number; lng: number }[] = [];
  if (houseNumber.length > 0) {
    const point = await locateAddressInZip(houseNumber, street, zip);
    if (point) points.push({ lat: point.lat, lng: point.lng });
  } else {
    points.push(...(await sampleStreetPoints(street, zip)));
  }

  if (points.length === 0) {
    /*
     * `locateAddressInZip` puts the ZIP into the query, so an address in the next ZIP over fails like a bad
     * address. Only on that failure, and only with a house number, ask where it does resolve.
     */
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
    const divisions = await divisionsAt(p.lat, p.lng);
    samples.push(
      divisions.map((d) => ({ ocdId: d.ocdId, divisionType: d.divisionType, label: d.label })),
    );
  }

  const resolution = resolveAddress(samples);

  /*
   * Contests come from the CONFIRMED divisions only. A level the street
   * genuinely crosses contributes nothing until the reader settles it, because
   * narrowing a ballot on a jurisdiction we are not sure of would hide
   * contests the reader may actually vote in — and hiding a contest silently
   * is how a reader ends up believing it does not exist.
   */
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
    { ok: true, resolution, contestIds: await contestIdsFor(confirmed), point },
    { headers: NO_STORE },
  );
}
