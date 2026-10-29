import { readZipPlace, placeMapQuery } from "../../place-map/reader.ts";
import type { Query } from "../../facts/publish.ts";

/** The place map is shared by pasted ZIP hunts and public readers. */
export async function stateOfZip(zip: string): Promise<string | null> {
  return (await readZipPlace(zip))?.states?.[0] ?? null;
}

export async function divisionIdsOfZip(zip: string): Promise<readonly string[] | null> {
  return (await readZipPlace(zip))?.ids ?? null;
}

export async function zipCountsByState(query?: Query): Promise<ReadonlyMap<string, number> | null> {
  try {
    const rows = await (query??placeMapQuery())(`SELECT lower(state) state,count(*)::int count FROM (
      SELECT DISTINCT e.state,m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id WHERE e.state IS NOT NULL
    ) memberships GROUP BY state`);
    return new Map(rows.map(row => [String(row.state), Number(row.count)]));
  } catch { return null; }
}
