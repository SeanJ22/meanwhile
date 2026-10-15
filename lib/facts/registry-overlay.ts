import type { Body } from "../registry/types.ts";
import type { BodyRoster, RosterReaderDisposition } from "../registry/body-rosters.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readFactCommentAccess } from "./comment-read.ts";
import type { Query } from "./publish.ts";
import { readFactRosters } from "./roster-read.ts";

const SCHEDULE_SQL = `SELECT f.entity_id, f.field, f.value, f.checked_at, (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url FROM fact f
  WHERE f.status = 'live' AND f.field IN ('name', 'homepage', 'meeting_cadence', 'agenda_url', 'office_address', 'office_phone') AND f.entity_id = ANY($1::text[])`;

/** One body's live facts as readers see them: its own fields, its members and its comment rules. */
export interface BodyFacts {
  readonly id: string;
  readonly division: string;
  readonly fields: Partial<Body>;
  readonly roster: BodyRoster | null;
  readonly dispositions: readonly RosterReaderDisposition[];
  readonly comment: CommentAccess | null;
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

/** The given bodies' live facts, one entry for each body that has any. */
export async function readBodyFacts(query: Query, bodyIds: readonly string[], withComments = true): Promise<BodyFacts[]> {
  const [{ rosters, dispositions }, fields, comments] = await Promise.all([readFactRosters(query, bodyIds), bodyFields(query, bodyIds),
    withComments ? readFactCommentAccess(query, bodyIds) : []]);
  const roster = new Map(rosters.map(row => [row.bodyId, row])), comment = new Map(comments.map(row => [row.bodyId, row]));
  const disposition = new Map(dispositions.map(row => [row.sourceId, row]));
  return [...new Set([...roster.keys(), ...Object.keys(fields), ...comment.keys()])].sort().map(id => ({
    id, division: id.split("#")[0]!, fields: fields[id] ?? {}, roster: roster.get(id) ?? null, comment: comment.get(id) ?? null,
    dispositions: (roster.get(id)?.members ?? []).flatMap(member => disposition.get(member.id) ?? []),
  }));
}

/** The registry readers see: the promoted partition with each body's facts laid on it. */
export function withStateFacts(carton: RegistryRuntimeCarton, bodies: readonly BodyFacts[]): RegistryRuntimeReadModel {
  const { bodyRosters: _oldRosters, rosterReaderDispositions: _oldDispositions, ...rest } = carton as RegistryRuntimeCarton & Partial<RegistryRuntimeReadModel>;
  const byBody = new Map(bodies.map(body => [body.id, body.fields]));
  const own = ({ officeAddress: _address, officePhone: _phone, ...body }: Body): Body => {
    const facts = byBody.get(body.id);
    if (!facts) return body;
    return { ...body, ...facts, ...(facts.fieldSources ? { fieldSources: { ...body.fieldSources, ...facts.fieldSources } } : {}) };
  };
  return { ...rest, registry: { ...rest.registry, bodies: rest.registry.bodies.map(own) },
    bodyRosters: bodies.flatMap(body => body.roster ?? []), rosterReaderDispositions: bodies.flatMap(body => body.dispositions) };
}

/** The registry with every body's facts read from the database: the runner's and workers' path. */
export async function withFactRegistry(carton: RegistryRuntimeCarton, query: Query | null): Promise<RegistryRuntimeReadModel> {
  return withStateFacts(carton, query === null ? [] : await readBodyFacts(query, carton.registry.bodies.map(body => body.id), false));
}
