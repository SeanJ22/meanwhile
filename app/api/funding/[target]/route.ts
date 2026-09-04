import { campaignMoneyApiAnswer } from "@/lib/funding/campaign-money";

/**
 * GET /api/funding/<app-side id> — the funding answer for one target (D34),
 * read from committed federal and normalized state snapshots. No live call, no key in this
 * environment; contributor rows arrive already ripcord-filtered by the
 * display builder.
 *
 * The target is a PATH segment, deliberately (D40). This response is
 * publicly cacheable, and a shared cache is only guaranteed to key on the
 * path: the first shipped form of this route took `?target=` and marked the
 * response `public`, and production's CDN served the first official's
 * cached body to every subsequent official — three politicians wearing one
 * campaign's books. Every request input that changes the body must live in
 * the path, where no cache implementation can drop it. The class is guarded
 * in tests/funding.test.ts: no query-keyed route may mark itself publicly
 * cacheable.
 *
 * `none` (a target the snapshot has never heard of) is a 200 with
 * kind:"none", not a 404 — the client renders nothing for it, and a
 * federal official with no funding answer is a data gap to record, not
 * an error to throw.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ target: string }> },
) {
  let target: string;
  try { target = decodeURIComponent((await params).target); }
  catch { return Response.json({ error: "invalid target encoding" }, { status: 400 }); }
  // Canonical local school-seat candidacy IDs exceed the old federal-only
  // 128-character budget. Keep a bounded input without truncating its identity.
  if (!target || target.length > 512) {
    return Response.json({ error: "target must contain 1–512 characters" }, { status: 400 });
  }
  try {
    return Response.json(campaignMoneyApiAnswer(target), {
      headers: { "cache-control": "public, max-age=3600" },
    });
  } catch (error) {
    console.error("funding read failed", error);
    return Response.json({ error: "funding data unavailable" }, { status: 503 });
  }
}
