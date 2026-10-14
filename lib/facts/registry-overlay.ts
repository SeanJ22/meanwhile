import type { Body } from "../registry/types.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { Query } from "./publish.ts";
import { readFactRosters } from "./roster-read.ts";

const SCHEDULE_SQL = `SELECT f.entity_id, f.field, f.value, f.checked_at, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
  WHERE f.status = 'live' AND f.field IN ('name', 'homepage', 'meeting_cadence', 'agenda_url', 'office_address', 'office_phone') AND f.entity_id = ANY($1::text[])`;

/** The registry readers see: the promoted partition with each body's members, sourced name, home page, schedule and office taken from live facts. */
export async function withFactRegistry(carton: RegistryRuntimeCarton, query: Query | null): Promise<RegistryRuntimeReadModel> {
  const { bodyRosters: _oldRosters, rosterReaderDispositions: _oldDispositions, ...rest } = carton as RegistryRuntimeCarton & Partial<RegistryRuntimeReadModel>;
  const bodyIds = rest.registry.bodies.map(body => body.id);
  const [{ rosters, dispositions }, schedules] = query === null ? [{ rosters: [], dispositions: [] }, []]
    : await Promise.all([readFactRosters(query, bodyIds), query(SCHEDULE_SQL, [bodyIds])]);
  const byBody = new Map<string, Partial<Body>>();
  for (const row of schedules) {
    const held = byBody.get(String(row.entity_id)) ?? {};
    const at = new Date(row.checked_at as string).toISOString();
    const source = { sourceUrl: String(row.url), sourceOrg: new URL(String(row.url)).hostname, collectedAt: at, verifiedAt: at };
    if (row.field === "name") Object.assign(held, { name: String(row.value), bodyOrigin: "SOURCED", provenance: source });
    else if (row.field === "office_address" || row.field === "office_phone" || row.field === "homepage") {
      const key = row.field === "office_address" ? "officeAddress" : row.field === "office_phone" ? "officePhone" : "homepageUrl";
      Object.assign(held, { [key]: String(row.value), fieldSources: { ...held.fieldSources, [key]: source } });
    } else if (row.field === "meeting_cadence") Object.assign(held, { meetingCadence: String(row.value), meetingCadenceSource: { sourceUrl: source.sourceUrl, collectedAt: at } });
    else held.agendaSourceRef = String(row.value);
    byBody.set(String(row.entity_id), held);
  }
  const own = ({ officeAddress: _address, officePhone: _phone, ...body }: Body): Body => {
    const facts = byBody.get(body.id);
    if (!facts) return body;
    return { ...body, ...facts, ...(facts.fieldSources ? { fieldSources: { ...body.fieldSources, ...facts.fieldSources } } : {}) };
  };
  return { ...rest, registry: { ...rest.registry, bodies: rest.registry.bodies.map(own) }, bodyRosters: rosters, rosterReaderDispositions: dispositions };
}
