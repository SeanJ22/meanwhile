import { factReader } from "@/lib/facts/db";
import { lowestZipByDivision } from "@/lib/place-map/reader";
import { lookupZcta } from "@/lib/geo/zcta";
import { publishedCountyDivisions, warmPlacesForCounties } from "@/lib/ops/warm-places";

export const dynamic = "force-dynamic";

/** The release fill and reader walks use the same published counties. No reader sources are preloaded. */
export async function GET(): Promise<Response> {
  try {
    const query = factReader();
    if (!query) throw new Error("Reader database unavailable");
    const rows = await query("SELECT DISTINCT place_id FROM entity_place WHERE place_id LIKE '%/county:%'");
    const counties = publishedCountyDivisions(rows.map(row => String(row.place_id)));
    const states = [...new Set(counties.map(county => county.split("/state:")[1].split("/")[0]))];
    const zipByDivision = new Map<string, string>();
    for (const state of states) {
      const indexed = await lowestZipByDivision(state);
      if (!indexed) throw new Error(`ZIP index unavailable for ${state}`);
      for (const [division, zip] of indexed) zipByDivision.set(division, zip);
    }
    return Response.json(warmPlacesForCounties({ counties,
      zipFor: county => zipByDivision.get(county), centroidFor: lookupZcta,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("READER_PLACES_LOAD_FAILED", error);
    return Response.json({ error: "Published places could not be loaded" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
