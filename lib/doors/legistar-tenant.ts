import type { BodySourceWiring } from "../registry/source-wiring.ts";
import type { Query } from "../facts/publish.ts";
import type { DoorRecord } from "./registry.ts";
import { wiringRowsFromDoors } from "./rows.ts";

export const LEGISTAR_TENANT_SQL = `CASE WHEN value #>> '{meeting,agendaSourceType}' IN ('LEGISTAR', 'LEGISTAR_INSITE')
  THEN CASE WHEN value #>> '{config,sourceRoutes}' = 'legistar-insite' OR value #>> '{meeting,agendaSourceType}' = 'LEGISTAR_INSITE'
    THEN lower(split_part(regexp_replace(value #>> '{config,insiteHost}', '^https?://', ''), '.', 1))
    ELSE lower(value #>> '{config,slug}') END END`;

export async function legistarTenantDoors(query: Query, slug: string) {
  if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
  const doors = (await query(`SELECT value FROM cp_doors WHERE (${LEGISTAR_TENANT_SQL}) = $1
    AND value->>'status' <> 'SUSPENDED' ORDER BY value #>> '{meeting,family}' NULLS FIRST, id`, [slug])).map(row => row.value as DoorRecord);
  const rows = new Map<string, BodySourceWiring>();
  for (const row of wiringRowsFromDoors(doors, { includeDerived: true })) if (!rows.has(row.bodyId)) rows.set(row.bodyId,
    { ...row, agendaSourceType: "LEGISTAR" as const,
      config: { ...row.config, slug, eventBodyName: row.config.eventBodyName || row.config.insiteBodyName || row.config.bodyName } });
  return [...rows.values()];
}
