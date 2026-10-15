import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { divisionsAt } from "@/lib/registry/server";

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
  let failed = false;
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    try {
      const candidate = source.normalize(await source.fetch());
      const hit = contestsForDivisions(candidate, ocdIds);
      if (hit.contests.length > 0 || hit.absences.length > 0 || hit.heldContests?.length) {
        return Response.json(
          {
            ok: true,
            contestIds: [...hit.contests, ...hit.heldContests ?? []].map((c) => c.id),
          },
          { headers: NO_STORE },
        );
      }
    } catch { failed = true; }
  }
  if (failed) return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  return Response.json({ ok: true, contestIds: [] }, { headers: NO_STORE });
}
