import { factReader } from "@/lib/facts/db";
import { lowestZipsForDivisions, placeMapQuery } from "@/lib/place-map/reader";
import { readZipLocations } from "@/lib/place-map/locations";
import { publishedCountyDivisions, warmPlacesForCounties } from "@/lib/ops/warm-places";

export const dynamic = "force-dynamic";

/** The release fill and reader walks use the same published counties. No reader sources are preloaded.
 * The CDN keeps the answer until the next deploy empties it, or a day at most. */
export async function GET(): Promise<Response> {
  try {
    const query = factReader();
    if (!query) throw new Error("Reader database unavailable");
    const rows = await query(`SELECT DISTINCT split_part(place_id,'#',1) AS place_id FROM entity_place
      WHERE place_id ~ '^ocd-division/country:us/state:[a-z]{2}/county:[^/#]+(#|$)'`);
    const counties = publishedCountyDivisions(rows.map(row => String(row.place_id)));
    const stateOf = (county: string) => county.split("/state:")[1].split("/")[0];
    // A county enters another state's walk only through its own entity state or a ZIP shared across a state line.
    const crossing = await placeMapQuery()(`SELECT DISTINCT m.place_id AS county,s.state FROM (SELECT o.zip,array_agg(DISTINCT p.state) AS states
        FROM zip_place o JOIN entity p ON p.id=o.place_id WHERE p.kind='place' AND p.state IS NOT NULL
        GROUP BY o.zip HAVING count(DISTINCT p.state)>1) x JOIN zip_place m ON m.zip=x.zip CROSS JOIN unnest(x.states) s(state)
      WHERE m.place_id=ANY($1::text[]) UNION SELECT id,state FROM entity WHERE id=ANY($1::text[]) AND kind='place'`, [counties]);
    const states = [...new Set(counties.map(stateOf))];
    // Each state's walk in turn: a later state's ZIP for a county replaces an earlier state's.
    const zipByDivision = new Map((await Promise.all(states.map(state => lowestZipsForDivisions(state, [...counties.filter(county => stateOf(county) === state),
      ...crossing.filter(row => String(row.state).toLowerCase() === state).map(row => String(row.county))])))).flatMap(walk => [...walk]));
    const locations = await readZipLocations([...zipByDivision.values()]);
    return Response.json(warmPlacesForCounties({ counties,
      zipFor: county => zipByDivision.get(county), centroidFor: zip => locations.get(zip),
    }), { headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Netlify-CDN-Cache-Control": "public, durable, max-age=86400" } });
  } catch (error) {
    console.error("READER_PLACES_LOAD_FAILED", error);
    return Response.json({ error: "Published places could not be loaded" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
