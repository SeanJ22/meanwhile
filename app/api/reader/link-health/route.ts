import { linkHealthEdgeStore, READER_LINK_HEALTH_TAG } from "@/lib/civic-data/reader-link-health-publication.ts";

export const runtime = "nodejs";
export async function GET() {
  try {
    const held = await linkHealthEdgeStore().read();
    return Response.json({ available: held !== null, ...(held?.snapshot ?? { deadAddresses: [] }) }, { headers: {
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
      "Netlify-Cache-Tag": READER_LINK_HEALTH_TAG,
      "Cache-Control": "public, max-age=0, must-revalidate",
    } });
  } catch {
    return Response.json({ available: false, deadAddresses: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
