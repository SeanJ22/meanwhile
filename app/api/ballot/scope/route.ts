import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { ballotPlaceDivisions } from "@/lib/ballot/reader-place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

export async function POST(request: Request) {
  let lat: number;
  let lng: number;
  let place: { zip?: unknown; divisions?: readonly string[] } = {};
  try {
    const body = (await request.json()) as { lat?: unknown; lng?: unknown; zip?: unknown; divisions?: readonly string[] };
    place = body;
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

  let ocdIds: string[];
  try { ocdIds = await ballotPlaceDivisions({ ...place, lat, lng }); }
  catch { return Response.json({ ok: false }, { status: 503, headers: NO_STORE }); }
  if (!ocdIds.length) return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  let failed = false;
  const contestIds = new Set<string>();
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    try {
      const candidate = source.normalize(await source.fetch());
      for (const contest of [...candidate.contests, ...candidate.heldContests ?? []]) contestIds.add(contest.id);
    } catch { failed = true; }
  }
  if (failed) return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  return Response.json({ ok: true, contestIds: [...contestIds] }, { headers: NO_STORE });
}
