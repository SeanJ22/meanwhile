import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { divisionsAt } from "@/lib/registry/server";

/**
 * POST /api/ballot/scope — which contests are on the ballot at ONE POINT
 * (item 2, 2026-08-15: "Show me my actual ballot").
 *
 * The ballot page resolves at a ZCTA centroid, which is orientation and not a
 * ballot — a zip crosses town, school and legislative lines, and the page has
 * said so at the top since it shipped. This route is the honest answer to
 * "then show me mine": a resolved street point, the divisions that actually
 * contain it, and the contest ids those divisions produce.
 *
 * ## POST, and everything the geocoder proxy's design says
 *
 * A GET would put a home's coordinates in a URL, and URLs reach access logs,
 * referrers and proxy caches this product cannot make promises about. Same
 * reasoning as `/api/geocode`, same guarantees:
 *
 * - **Nothing is written.** No log row (this route never calls `logEvent`),
 *   no store, no cache, no console line carrying the point.
 * - **`no-store`.** The answer is per-reader by construction, so it must
 *   never sit in a shared cache — the D40 family's rule, which production
 *   already broke once by serving one campaign's books for three
 *   politicians.
 * - **Only contest ids come back.** Not the divisions, not a label, nothing
 *   that reconstructs the point.
 *
 * The point itself never leaves the reader's browser except as this request
 * body, and it is not stored there either — the ballot page holds it in React
 * state for as long as the tab is open on it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

export async function POST(request: Request) {
  let lat: number;
  let lng: number;
  try {
    const body = (await request.json()) as { lat?: unknown; lng?: unknown };
    lat = typeof body.lat === "number" ? body.lat : Number.NaN;
    lng = typeof body.lng === "number" ? body.lng : Number.NaN;
  } catch {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  // A validity check, not a rate limit — closed shape, real bounds, never
  // behind a flag (CLAUDE.md: validity checks never switch off).
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  }

  const divisions = await divisionsAt(lat, lng);
  const ocdIds = divisions.map((d) => d.ocdId);

  // The same loop the page runs, asked at a point instead of a centroid, so
  // the two can never disagree about what a set contains.
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    const candidate = source.normalize(await source.fetch());
    const hit = contestsForDivisions(candidate, ocdIds);
    if (hit.contests.length > 0 || hit.absences.length > 0) {
      return Response.json(
        {
          ok: true,
          contestIds: hit.contests.map((c) => c.id),
        },
        { headers: NO_STORE },
      );
    }
  }

  // A point no registered source answers for. `ok` with an empty list is a
  // real answer and must not be confused with a failure: the page says "we
  // hold no ballot for that address" rather than silently showing the zip's.
  return Response.json({ ok: true, contestIds: [] }, { headers: NO_STORE });
}
