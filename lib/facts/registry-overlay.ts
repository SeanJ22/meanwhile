import type { Body } from "../registry/types.ts";
import type { BodyRoster, RosterReaderDisposition } from "../registry/body-rosters.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readFactCommentAccess } from "./comment-read.ts";
import type { Query } from "./publish.ts";
import { readFactRosters } from "./roster-read.ts";

const SCHEDULE_SQL = `SELECT f.entity_id, f.field, f.value, f.checked_at, (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url FROM fact f
  WHERE f.status = 'live' AND f.field IN ('name', 'homepage', 'meeting_cadence', 'agenda_url', 'office_address', 'office_phone') AND f.entity_id = ANY($1::text[])`;

/** One state's live facts as readers see them: each body's own fields, its members and its comment rules. */
export interface StateFacts {
  readonly bodies: Readonly<Record<string, Partial<Body>>>;
  readonly rosters: readonly BodyRoster[];
  readonly dispositions: readonly RosterReaderDisposition[];
  readonly comments: readonly CommentAccess[];
}

async function bodyFields(query: Query, bodyIds: readonly string[]): Promise<Record<string, Partial<Body>>> {
  const byBody: Record<string, Partial<Body>> = {};
  for (const row of await query(SCHEDULE_SQL, [bodyIds])) {
    const held = byBody[String(row.entity_id)] ??= {};
    const at = new Date(row.checked_at as string).toISOString();
    const source = { sourceUrl: String(row.url), sourceOrg: new URL(String(row.url)).hostname, collectedAt: at, verifiedAt: at };
    if (row.field === "name") Object.assign(held, { name: String(row.value), bodyOrigin: "SOURCED", provenance: source });
    else if (row.field === "office_address" || row.field === "office_phone" || row.field === "homepage") {
      const key = row.field === "office_address" ? "officeAddress" : row.field === "office_phone" ? "officePhone" : "homepageUrl";
      Object.assign(held, { [key]: String(row.value), fieldSources: { ...held.fieldSources, [key]: source } });
    } else if (row.field === "meeting_cadence") Object.assign(held, { meetingCadence: String(row.value), meetingCadenceSource: { sourceUrl: source.sourceUrl, collectedAt: at } });
    else held.agendaSourceRef = String(row.value);
  }
  return byBody;
}

/** The given bodies' live facts. */
export async function readStateFacts(query: Query, bodyIds: readonly string[]): Promise<StateFacts> {
  const [{ rosters, dispositions }, bodies, comments] = await Promise.all([readFactRosters(query, bodyIds), bodyFields(query, bodyIds), readFactCommentAccess(query, bodyIds)]);
  return { bodies, rosters, dispositions, comments };
}

/** A state's facts with the given bodies' entries replaced by freshly read ones. */
export function patchStateFacts(prior: StateFacts, fresh: StateFacts, bodyIds: ReadonlySet<string>): StateFacts {
  const replaced = new Set(prior.rosters.filter(roster => bodyIds.has(roster.bodyId)).flatMap(roster => roster.members.map(member => member.id)));
  return {
    bodies: { ...Object.fromEntries(Object.entries(prior.bodies).filter(([bodyId]) => !bodyIds.has(bodyId))), ...fresh.bodies },
    rosters: [...prior.rosters.filter(roster => !bodyIds.has(roster.bodyId)), ...fresh.rosters],
    dispositions: [...prior.dispositions.filter(row => !replaced.has(row.sourceId)), ...fresh.dispositions],
    comments: [...prior.comments.filter(row => !bodyIds.has(row.bodyId)), ...fresh.comments],
  };
}

/** The registry readers see: the promoted partition with each state's facts laid on its bodies. */
export function withStateFacts(carton: RegistryRuntimeCarton, states: readonly StateFacts[]): RegistryRuntimeReadModel {
  const { bodyRosters: _oldRosters, rosterReaderDispositions: _oldDispositions, ...rest } = carton as RegistryRuntimeCarton & Partial<RegistryRuntimeReadModel>;
  const byBody = new Map(states.flatMap(state => Object.entries(state.bodies)));
  const own = ({ officeAddress: _address, officePhone: _phone, ...body }: Body): Body => {
    const facts = byBody.get(body.id);
    if (!facts) return body;
    return { ...body, ...facts, ...(facts.fieldSources ? { fieldSources: { ...body.fieldSources, ...facts.fieldSources } } : {}) };
  };
  return { ...rest, registry: { ...rest.registry, bodies: rest.registry.bodies.map(own) },
    bodyRosters: states.flatMap(state => state.rosters), rosterReaderDispositions: states.flatMap(state => state.dispositions) };
}

/** The registry with every body's facts read from the database: the runner's and workers' path. */
export async function withFactRegistry(carton: RegistryRuntimeCarton, query: Query | null): Promise<RegistryRuntimeReadModel> {
  if (query === null) return withStateFacts(carton, []);
  const bodyIds = carton.registry.bodies.map(body => body.id);
  const [{ rosters, dispositions }, bodies] = await Promise.all([readFactRosters(query, bodyIds), bodyFields(query, bodyIds)]);
  return withStateFacts(carton, [{ bodies, rosters, dispositions, comments: [] }]);
}
