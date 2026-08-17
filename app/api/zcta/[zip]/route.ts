import { zctaOutline } from "@/lib/geo/zcta-outline";

/**
 * GET /api/zcta/<zip> — the one ZCTA polygon behind the current-zip shading
 * (g4 item 4).
 *
 * The zip is a PATH segment, deliberately, and for the reason D40 wrote into
 * `CLAUDE.md`: this response is publicly cacheable and varies by the zip, and
 * a shared cache is only guaranteed to key on the path. Production once
 * served one campaign's books for three politicians because a `public`
 * response was keyed on a query string the CDN dropped. Every request input
 * that changes the body lives in the path here, where nothing can drop it.
 *
 * A zip we hold no polygon for is a 200 with `{ outline: null }`, not a 404.
 * It is the honest and expected answer for the 31,902 ZCTAs outside the
 * covered states, and for the two inside them that have a centroid but no
 * area — the map has already flown to the centroid and simply renders no
 * tint. A 404 would make a routine coverage gap look like a broken request.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ zip: string }> },
) {
  const zip = decodeURIComponent((await params).zip);
  if (!/^\d{5}$/.test(zip)) {
    return Response.json({ error: "five-digit zip required" }, { status: 400 });
  }

  try {
    const outline = zctaOutline(zip);
    return Response.json(
      { zip, outline },
      // Immutable for a day: this is committed Census geometry that changes
      // only when `pnpm zcta:outlines` is re-run and redeployed.
      { headers: { "cache-control": "public, max-age=86400" } },
    );
  } catch (error) {
    console.error("zcta outline read failed", error);
    // Ambient decoration. A failure renders no tint and nothing else changes,
    // so this never becomes an outage over a shading.
    return Response.json({ zip, outline: null }, { status: 200 });
  }
}
