import type { CheckEntity } from "./check.ts";
import type { Query } from "./publish.ts";

const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", AS: "American Samoa",
  GU: "Guam", MP: "Northern Mariana Islands", PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};

export const stateName = (code: string | null): string | null => (code ? STATE_NAMES[code.toUpperCase()] ?? null : null);

/** The entity as the check sees it: its name in its state, its own and its parents' official hosts, and its ids. */
export async function readCheckEntity(query: Query, id: string): Promise<CheckEntity | null> {
  const [row] = await query(`WITH RECURSIVE up(id, depth) AS (
      SELECT $1::text, 0 UNION ALL SELECT e.parent_id, up.depth + 1 FROM entity e JOIN up ON e.id = up.id WHERE e.parent_id IS NOT NULL AND up.depth < 8)
    SELECT e.name, e.state,
      coalesce((SELECT array_agg(DISTINCT host) FROM entity_host WHERE entity_id IN (SELECT id FROM up)), '{}') AS hosts,
      coalesce((SELECT array_agg(value) FROM entity_external_id WHERE entity_id = $1 AND scheme NOT LIKE 'roster-%'), '{}') AS ids
    FROM entity e WHERE e.id = $1`, [id]);
  if (!row) return null;
  return { id, fullName: String(row.name), stateName: stateName(row.state as string | null),
    hosts: (row.hosts as string[]) ?? [], externalIds: (row.ids as string[]) ?? [] };
}
