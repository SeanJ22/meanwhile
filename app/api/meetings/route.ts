import { haversineKm } from "@/lib/geo/distance";
import { nearestZcta } from "@/lib/geo/zcta";
import { logSearchEvent } from "@/lib/db/search-log";
import { afterResponse } from "@/lib/log/after-response";

import { raiseWriteAlarm } from "@/lib/db/write-alarm";
import { markerFromRequest } from "@/lib/db/run-marker";
import { RADIUS_LADDER_KM, searchMeetings } from "@/lib/meetings/query";
import { getActiveSnapshotMeta } from "@/lib/meetings/snapshot";
import { wiringForSourceName } from "@/lib/sources/composite/wiring";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
import { needsPill, zipCertainty } from "@/lib/geo/zip-certainty";
import { coverageAt, divisionsAt, divisionsByOcdIds } from "@/lib/registry/server";
import type { Division } from "@/lib/registry/types";
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

  /*
   * D18: which divisions actually contain this point.
   *
   * The cascade filters by distance, and a meeting held online has none — so
   * without this a virtual sitting is invisible at every radius. This is the
   * exact answer for a body we hold a division for, resolved from the SAME
   * committed geometry the coverage summary and the who-governs card use.
   * It runs before the search because the search needs it, and it degrades to
   * an empty set rather than failing the request: `within()` then falls back
   * to its body-in-view clause, which is a narrower answer and never a wrong
   * one.
   */
  let divisionsAtPoint = new Set<string>();
  /*
   * AUD-04 (2026-08-18): the resolved divisions are KEPT, not just reduced to
   * their ids, so the coverage summary below can reuse them instead of sweeping
   * the same point against the same polygons a second time. One geometry answer
   * reused inside one request; nothing is stored and nothing is joined.
   *
   * It stays null when the lookup FAILED, and that distinction is the whole
   * safety of the change: an empty result from a failed resolution must not be
   * handed to `coverageAt` as though it were an answer, or a lookup failure
   * would render as "no body governs here" — a retrieval failure written into
   * the data as an absence. Null means "resolve it yourself", which is exactly
   * what happened before this change.
   */
  let resolvedDivisions: Division[] | null = null;
  try {
    resolvedDivisions = await divisionsAt(lat, lng);
    divisionsAtPoint = new Set(resolvedDivisions.map((d) => d.ocdId));
  } catch (error) {
    console.error("division lookup failed; online meetings fall back to body-in-view", error);
  }

  /*
   * **A ZIP IS AN AREA, AND THIS CARD IS LITERALLY CALLED "WHO GOVERNS HERE".**
   * (NJ Hunt 3 item 3.1, 2026-08-22 — the second instance of `NJ01`.)
   *
   * `NJ01` fixed the ballot page and this surface was left on the old
   * behaviour, because nobody swept the class. Production at 07866 read "4
   * bodies govern the area around 07866" over a list holding Rockaway TOWNSHIP
   * and not Rockaway BOROUGH — a separate municipality inside the same zip,
   * with its own council, its own school district and its own ballot, missing
   * from the card whose whole job is to answer that question.
   *
   * So when the reader TYPED a zip, the divisions are widened to every one
   * whose territory reaches inside it, exactly as the ballot page does.
   *
   * Three things this is careful about:
   *
   * - **Only on a typed zip.** A settled-viewport fetch carries none: the
   *   reader panned rather than named a place, and widening to a zip they did
   *   not type would answer about somewhere they are not.
   * - **Only when the point lookup SUCCEEDED.** A failed resolution stays
   *   null and is passed as null, so a retrieval failure is never written into
   *   the coverage answer as "nothing governs here".
   * - **It can only ADD.** The point's own divisions are the starting set and
   *   are never removed, so nothing a reader saw yesterday disappears today —
   *   the failed-fetch-never-empties-a-full-surface rule, applied to a
   *   resolver change.
   *
   * The online-meeting filter is widened with it, deliberately: a Borough
   * resident's own council meeting held online is a meeting they should see,
   * and this set only ever grows the list.
   */
  if (zipRead.value && resolvedDivisions) {
    const areaIds = await divisionIdsForZipArea(
      zipRead.value,
      resolvedDivisions.map((d) => d.ocdId),
    );
    const widened = await divisionsByOcdIds(areaIds);
    if (widened.length >= resolvedDivisions.length) {
      resolvedDivisions = widened;
      divisionsAtPoint = new Set(widened.map((d) => d.ocdId));
    }
  }

  const result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionsAtPoint);

  // A coverage statement we cannot stand behind is worse than none, so a
  // registry that fails to load degrades to the cascade's own answer rather
  // than failing the whole request or guessing.
  let coverage = null;
  try {
    coverage = await coverageAt(
      lat,
      lng,
      result.meetings.length,
      resolvedDivisions ?? undefined,
    );
  } catch (error) {
    console.error("coverage lookup failed", error);
  }

  /*
   * **RULING 71 ON THE CARD THAT ASKS THE QUESTION.** (NJ Hunt 3 item 3.3.)
   *
   * The widening above makes Rockaway Borough APPEAR beside Rockaway Township.
   * On its own that trades one wrong answer for a longer one: eight bodies
   * listed identically, when two of them govern everyone at 07866 and six
   * govern some readers and not others. So each body carries whether its
   * territory covers the whole zip, and only the partial ones get the pill.
   *
   * Only on a TYPED zip, for the same reason the widening is: a reader who
   * panned has named no place, and there is then no zip for a body to be
   * partial about. Absent means not-applicable, never certain — the field is
   * optional precisely so those two cannot be written as the same thing.
   */
  if (coverage && zipRead.value) {
    const certainty = await zipCertainty(zipRead.value);
    if (certainty) {
      coverage = {
        ...coverage,
        bodies: coverage.bodies.map((body) =>
          body.ocdId && needsPill(certainty.certaintyOf(body.ocdId))
            ? { ...body, couldGovern: true }
            : body,
        ),
      };
    }
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
  /*
   * **THE WRITE ITSELF IS DEFERRED, NOT ONLY ITS ALARM** (Prompt E item 4,
   * 2026-08-20; `PD04`).
   *
   * Prompt D found that an unawaited promise is dropped when a serverless
   * invocation returns, and fixed it — for the ALARM. The INSERT one line
   * above it had exactly the same shape and was left alone: `logSearchEvent()`
   * was called, its promise was never awaited and never handed to `after()`,
   * and the handler returned its JSON immediately below. Every row that had
   * not reached Neon by the time the response went out was dropped by the
   * runtime, silently, with no alarm — because a dropped promise never
   * rejects, so there is nothing for a `.catch` to catch.
   *
   * That is the class the named-instance rule points at: one sighting of a
   * floating promise on a sold-store write path was one of two, in the same
   * function, five lines apart. `tests/write-alarm.test.ts` now asserts every
   * sold-store write in `app/api/` is either awaited or inside `after()`, so
   * the third one cannot ship.
   *
   * **RULING 25 — THE READER-FACING BEHAVIOUR IS UNCHANGED.** The catch still
   * swallows, the search has already answered, and the response below is
   * byte-identical. `after()` runs strictly after the response has gone; it
   * costs the reader nothing and buys the row a runtime that stays alive long
   * enough to write it.
   */
  /*
   * Read from the request BEFORE the response goes. `after()` runs once the
   * invocation has answered, and a request object read at that point is a
   * different question from a request object read during the handler; a run
   * that declared itself in a header must not become a reader because we
   * asked too late. Captured here, used in the closure below.
   */
  const marker = markerFromRequest(request);
  await afterResponse(() =>
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
      marker,
    }).catch(async (error) => {
      /*
       * Still swallowed for the reader, still raised for us. The alarm no
       * longer needs its own `after()` — it is already inside one, and
       * nesting a second would schedule work from work the platform is
       * already keeping alive. Awaited here so the invocation stays up for
       * it, which is the whole reason `after()` is wrapped round the outside.
       */
      console.error("search log write failed", error);
      await raiseWriteAlarm("search_log", error);
    }),
  );

  /*
   * M81 — which of these bodies actually governs the reader.
   *
   * The division ids the point already resolved into, sent as an ARRAY so the
   * client can badge every card without a second request and without a second
   * geometry source. `null` when the resolution FAILED, which is not the same
   * as an empty list: an empty list treated as an answer would badge every
   * meeting on screen "Nearby, different jurisdiction" — a specific false
   * claim produced by our own lookup failing. Null makes every badge read as
   * the named gap it is.
   */
  const governingOcdIds = resolvedDivisions
    ? resolvedDivisions.map((d) => d.ocdId)
    : null;

  return Response.json({
    ...result,
    coverage,
    snapshot,
    nearZip,
    governingOcdIds,
  });
}
