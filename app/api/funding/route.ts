import { fundingAnswerForTarget } from "@/lib/funding/display";

/**
 * GET /api/funding?target=<app-side id> — the funding answer for one
 * target (D34), read from the committed FEC snapshot. No live FEC call,
 * no key in this environment; contributor rows arrive already
 * ripcord-filtered by the display builder.
 *
 * `none` (a target the snapshot has never heard of) is a 200 with
 * kind:"none", not a 404 — the client renders nothing for it, and a
 * federal official with no funding answer is a data gap to record, not
 * an error to throw.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target");
  if (!target || target.length > 128) {
    return Response.json({ error: "target required" }, { status: 400 });
  }
  try {
    return Response.json(fundingAnswerForTarget(target), {
      headers: { "cache-control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("funding read failed", error);
    return Response.json({ error: "funding data unavailable" }, { status: 503 });
  }
}
