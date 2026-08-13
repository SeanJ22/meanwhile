import { logSearchEvent } from "@/lib/db/search-log";
import { RADIUS_LADDER_KM, searchMeetings } from "@/lib/meetings/query";
import { getActiveSnapshotMeta } from "@/lib/meetings/snapshot";
import { wiringForSourceName } from "@/lib/sources/composite/wiring";
import { coverageAt } from "@/lib/registry/server";

/**
 * GET /api/meetings?lat=&lng=&radiusKm=
 *
 * The map's only data dependency. It returns normalized meetings plus which
 * rung of the empty-state cascade produced them, so the client can say what it
 * did rather than silently showing a wider area than was asked for.
 *
 * It also attaches the coverage summary: which bodies govern this point and how
 * many of them have a calendar wired. The two answers belong together, because
 * an empty meeting list means nothing until you know whether it is government
 * being quiet or us being blind.
 */

// The registry reads its geometry off the filesystem, which needs Node.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return Response.json({ error: "lat must be between -90 and 90" }, { status: 400 });
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return Response.json({ error: "lng must be between -180 and 180" }, { status: 400 });
  }

  const requested = Number(params.get("radiusKm"));
  const radiusKm =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1])
      : RADIUS_LADDER_KM[0];

  const result = await searchMeetings(lat, lng, radiusKm);

  // A coverage statement we cannot stand behind is worse than none, so a
  // registry that fails to load degrades to the cascade's own answer rather
  // than failing the whole request or guessing.
  let coverage = null;
  try {
    coverage = await coverageAt(lat, lng, result.meetings.length);
  } catch (error) {
    console.error("coverage lookup failed", error);
  }

  // When the snapshot serves the answer, say how old it is and which sources
  // it is missing — a failed source's bodies would otherwise show nothing
  // with no hint that the gap is ours and temporary.
  const meta = getActiveSnapshotMeta();
  const snapshot = meta
    ? {
        ...meta,
        failed: meta.sources
          .filter((s) => !s.ok)
          .map((s) => ({
            source: s.source,
            // A division-less body (null ocdId) has no division to attribute
            // the failure to; its absence is visible on the body itself.
            ocdIds: wiringForSourceName(s.source).flatMap((row) =>
              row.ocdId ? [row.ocdId] : [],
            ),
          })),
      }
    : null;

  // The search log row: what was asked and where, never who. Fire-and-forget
  // — a logging failure or an absent DATABASE_URL must never cost the reader
  // their answer. Disclosed on /transparency, which ships with this code.
  const zipParam = params.get("zip");
  const zip = zipParam && /^\d{5}$/.test(zipParam) ? zipParam : null;
  const resolvedOcdIds = coverage
    ? [
        ...coverage.bodies.flatMap((b) => (b.ocdId ? [b.ocdId] : [])),
        ...coverage.seats.map((s) => s.ocdId),
      ]
    : [];
  logSearchEvent({
    eventType: "SEARCH",
    approximateLocation: zip,
    ocdIds: resolvedOcdIds,
    detail: {
      tier: result.tier,
      radiusKm: result.radiusKm,
      requestedRadiusKm: result.requestedRadiusKm,
      meetingCount: result.meetings.length,
    },
  }).catch((error) => console.error("search log write failed", error));

  return Response.json({ ...result, coverage, snapshot });
}
