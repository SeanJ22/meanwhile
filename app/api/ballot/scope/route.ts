import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { divisionsAt } from "@/lib/registry/server";

/**
 * POST /api/ballot/scope: the contest ids on the ballot at one resolved point. POST so a home's coordinates
 * never sit in a URL. Nothing is written, the answer is `no-store`, and only contest ids come back.
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
  // behind a flag.
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
