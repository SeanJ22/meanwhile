import { haversineKm } from "@/lib/geo/distance";
import { nearestZcta } from "@/lib/geo/zcta";
import { logSearchEvent } from "@/lib/db/search-log";
import { markerFromRequest } from "@/lib/db/run-marker";
import { RADIUS_LADDER_KM, searchMeetings } from "@/lib/meetings/query";
import { getActiveSnapshotMeta } from "@/lib/meetings/snapshot";
import { wiringForSourceName } from "@/lib/sources/composite/wiring";
import { coverageAt } from "@/lib/registry/server";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";

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

  /*
   * ITEM 1b (2026-08-17): this block used to read
   *
   *   const lat = Number(params.get("lat"));
   *
   * and `Number(null)` is 0, not NaN. A request carrying no coordinates at
   * all — `/api/meetings?zip=85701`, the shape the h session's probe sent —
   * passed both range checks and searched 0°N 0°E, climbing the radius ladder
   * to 150 km in the Gulf of Guinea and answering 200 with a centre, a tier
   * and a `nearZip` of "85701". It also wrote that into the search log.
   *
   * The reader-facing rule is `lib/api/params.ts`: absent or malformed
   * refuses with a stated reason, and an unknown parameter is named back to
   * the caller rather than ignored — because the original request was not a
   * malformed coordinate, it was a caller using a parameter this route does
   * not locate by.
   */
  const KNOWN = ["lat", "lng", "radiusKm", "zip"] as const;
  const unknown = rejectUnknown(params, KNOWN);
  if (!unknown.ok) return refuse(unknown.error);

  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const lat = latRead.value;
  const lng = lngRead.value;

  /*
   * `radiusKm` is genuinely optional — absent means "start at the ladder's
   * first rung", which is a documented default for a parameter the caller
   * never sent. Present-but-unparseable is a different thing and refuses:
   * `?radiusKm=abc` silently becoming 25 km is the same class of defect one
   * size down, an answer about a smaller area than the caller asked for with
   * nothing on screen to say so.
   */
  const radiusRead = numeric(params, "radiusKm", { default: RADIUS_LADDER_KM[0] });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) {
    return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  }
  const radiusKm = Math.min(
    radiusRead.value,
    RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1],
  );

  /*
   * ITEM 1b: a malformed zip refuses rather than silently becoming null.
   * `?zip=8570` — one digit short, a typo a client could ship — used to log a
   * search with no location at all, and a row with a missing location is
   * indistinguishable in the sold store from a reader who panned into open
   * water. Absent is still fine and means "the reader panned, they didn't
   * type"; the nearest ZCTA centroid answers that case below.
   *
   * Read at the door, with the others, so a refused request never runs the
   * search — a refusal that arrives after the work is a refusal the caller
   * paid for.
   */
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);

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
  // `meta.carried` rides along untouched (hotfix-0817): the footer's one age is true of
  // the fresh rows only, and the count of rows it is NOT true of has to reach
  // the client or the line keeps speaking for them.
  const snapshot = meta
    ? {
        ...meta,
        failed: meta.sources
          .filter((s) => !s.ok || (s.unreachableOcdIds?.length ?? 0) > 0)
          .map((s) => ({
            source: s.source,
            // A PARTIAL refusal names its own divisions and nothing else
            // (g3). Before this, a source serving five bodies across three
            // hosts put the "we couldn't reach their calendar source" line on
            // all five whenever one of them refused — telling four readers
            // their government's calendar was unreachable when it was on
            // screen in front of them.
            //
            // A whole-source failure still attributes to every body the
            // source serves. A division-less body (null ocdId) has no
            // division to attribute the failure to; its absence is visible on
            // the body itself.
            ocdIds:
              s.ok && s.unreachableOcdIds
                ? s.unreachableOcdIds
                : wiringForSourceName(s.source).flatMap((row) =>
                    row.ocdId ? [row.ocdId] : [],
                  ),
          })),
      }
    : null;

  // The search log row: what was asked and where, never who. Fire-and-forget
  // — a logging failure or an absent DATABASE_URL must never cost the reader
  // their answer. Disclosed on /transparency, which ships with this code.
  const zip = zipRead.value;

  // The settled-viewport fetch (2i) carries no zip — the reader panned, they
  // didn't type. Resolve the nearest ZCTA centroid so the notices and the
  // ballot bubble can name the area, and cap it: a center more than 60 km
  // from every centroid (open water, deep wilderness) honestly has no zip.
  // Same orientation-only status as a typed zip — never district truth.
  let nearZip: string | null = zip;
  if (!nearZip) {
    const near = nearestZcta(lat, lng);
    nearZip =
      near && haversineKm(lat, lng, near.lat, near.lng) <= 60 ? near.zip : null;
  }
  const resolvedOcdIds = coverage
    ? [
        ...coverage.bodies.flatMap((b) => (b.ocdId ? [b.ocdId] : [])),
        ...coverage.seats.map((s) => s.ocdId),
      ]
    : [];
  logSearchEvent({
    eventType: "SEARCH",
    // Zip-level either way: the typed zip, or the nearest centroid's zip for
    // a panned viewport. Never coordinates — the log stays orientation-only.
    approximateLocation: nearZip,
    ocdIds: resolvedOcdIds,
    detail: {
      tier: result.tier,
      radiusKm: result.radiusKm,
      requestedRadiusKm: result.requestedRadiusKm,
      meetingCount: result.meetings.length,
    },
    // C05: whose traffic this is. A walk declares itself in a header; a
    // reader declares nothing and is organic.
    marker: markerFromRequest(request),
  }).catch((error) => console.error("search log write failed", error));

  return Response.json({ ...result, coverage, snapshot, nearZip });
}
