import type { Body } from "../registry/types.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { Query } from "./publish.ts";
import { readFactRosters } from "./roster-read.ts";

const SCHEDULE_SQL = `SELECT f.entity_id, f.field, f.value, f.checked_at, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
  WHERE f.status = 'live' AND f.field IN ('meeting_cadence', 'agenda_url') AND f.entity_id = ANY($1::text[])`;

/** The registry readers see: the promoted partition with each body's members and schedule taken from live facts. */
export async function withFactRegistry(carton: RegistryRuntimeCarton, query: Query | null): Promise<RegistryRuntimeReadModel> {
  const { bodyRosters: _oldRosters, rosterReaderDispositions: _oldDispositions, ...rest } = carton as RegistryRuntimeCarton & Partial<RegistryRuntimeReadModel>;
  if (query === null) return { ...rest, bodyRosters: [], rosterReaderDispositions: [] };
  const bodyIds = rest.registry.bodies.map(body => body.id);
  const [{ rosters, dispositions }, schedules] = await Promise.all([readFactRosters(query, bodyIds), query(SCHEDULE_SQL, [bodyIds])]);
  const byBody = new Map<string, Partial<Body>>();
  for (const row of schedules) {
    const held = byBody.get(String(row.entity_id)) ?? {};
    if (row.field === "meeting_cadence") Object.assign(held, { meetingCadence: String(row.value),
      meetingCadenceSource: { sourceUrl: String(row.url), collectedAt: new Date(row.checked_at as string).toISOString() } });
    else held.agendaSourceRef = String(row.value);
    byBody.set(String(row.entity_id), held);
  }
  return { ...rest, registry: { ...rest.registry, bodies: rest.registry.bodies.map(body => byBody.has(body.id) ? { ...body, ...byBody.get(body.id) } : body) },
    bodyRosters: rosters, rosterReaderDispositions: dispositions };
}
