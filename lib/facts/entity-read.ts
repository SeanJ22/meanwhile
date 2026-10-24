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

export const stateCodeOf = (name: string): string | null => Object.entries(STATE_NAMES).find(([, full]) => full === name)?.[0] ?? null;

/** The entity as the check sees it: its name in its state, the official hosts of its parents and of the governments at its place, and its ids. */
export async function readCheckEntity(query: Query, id: string): Promise<CheckEntity | null> {
  const [row] = await query(`WITH RECURSIVE subject AS (
      SELECT coalesce((SELECT entity_id FROM entity_external_id WHERE scheme = 'body-alias' AND value = $1), $1::text) AS id
    ), up(id, depth) AS (
      SELECT id, 0 FROM subject UNION ALL SELECT e.parent_id, up.depth + 1 FROM entity e JOIN up ON e.id = up.id WHERE e.parent_id IS NOT NULL AND up.depth < 8),
    near AS (SELECT up.id FROM up JOIN entity p ON p.id = up.id WHERE p.kind = 'place' AND up.id !~ '^ocd-division/country:us/state:[a-z]{2}$' ORDER BY up.depth LIMIT 1)
    SELECT e.id, e.name, e.state,
      coalesce((SELECT ARRAY[f.value #>> '{}',f.value_text] FROM fact f
        WHERE f.entity_id=e.id AND f.field='name' AND f.status='live'),'{}') AS names,
      coalesce((SELECT array_agg(DISTINCT host) FROM entity_host WHERE entity_id IN (SELECT id FROM up)
        OR entity_id IN (SELECT g.id FROM entity g WHERE g.kind = 'government' AND g.parent_id IN (SELECT id FROM near))), '{}') AS hosts,
      coalesce((SELECT array_agg(value) FROM entity_external_id WHERE entity_id = e.id AND scheme NOT LIKE 'roster-%' AND scheme <> 'body-alias'), '{}') AS ids
    FROM entity e JOIN subject ON e.id = subject.id`, [id]);
  if (!row) return null;
  return { id: String(row.id), fullName: String(row.name), names: (row.names as string[]) ?? [], stateName: stateName(row.state as string | null),
    hosts: (row.hosts as string[]) ?? [], externalIds: (row.ids as string[]) ?? [] };
}
