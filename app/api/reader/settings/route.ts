import { settingsEdgeStore, READER_SETTINGS_TAG } from "@/lib/civic-data/reader-settings-publication.ts";

export const runtime = "nodejs";
export async function GET() {
  try {
    const held = await settingsEdgeStore().read();
    return Response.json({ available: held !== null, ...(held?.snapshot ?? { values: {} }) }, { headers: {
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
      "Netlify-Cache-Tag": READER_SETTINGS_TAG,
      "Cache-Control": "public, max-age=0, must-revalidate",
    } });
  } catch {
    return Response.json({ available: false, values: {} }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
