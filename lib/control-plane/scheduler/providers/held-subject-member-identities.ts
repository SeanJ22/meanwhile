import { ensureEntity } from "../../../facts/entities.ts";
import { nameKey } from "../../../facts/roster-facts.ts";
import type { FactDb, Query } from "../../../facts/publish.ts";

export interface HeldMemberIdentity { readonly id: string; readonly name: string; readonly personId: string }

/** Exact body identities only. Contacts, biographies and the remainder of the state's registry stay in Postgres. */
export const HELD_MEMBER_IDENTITIES_SQL = `WITH runtime AS MATERIALIZED (
    SELECT reader_payload_node(payload) value FROM civic_data_promotions
      WHERE key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
  ), native AS (
    SELECT reader_payload_node(m.item) member FROM runtime root,
      LATERAL reader_payload_members(root.value->'bodyRosters') r,
      LATERAL reader_payload_members(reader_payload_node(r.item)->'members') m
      WHERE reader_payload_node(r.item)->>'bodyId'=$2 AND EXISTS (
        SELECT 1 FROM reader_payload_members(reader_payload_node(root.value->'registry')->'bodies') b
          WHERE reader_payload_node(b.item)->>'id'=$2)
  ) SELECT member->>'id' id,member->>'name' name,coalesce(nullif(member->>'personId',''),member->>'id') person_id FROM native
    UNION ALL SELECT coalesce((SELECT x.value FROM entity_external_id x
      WHERE x.entity_id=substr(f.field,8) AND x.scheme='roster-member' LIMIT 1),
      'roster:'||$2||'#'||substr(f.field,8)),f.value->>'name',substr(f.field,8)
      FROM fact f WHERE f.entity_id=$2 AND f.status='live' AND f.field LIKE 'member:%'`;

export async function readHeldMemberIdentities(query: Query, state: string, bodyId: string): Promise<readonly HeldMemberIdentity[]> {
  if (!/^[A-Z]{2}$/.test(state) || !bodyId) return [];
  const namedState = /\/(?:state|territory|district):([a-z]{2})(?:\/|#|$)/i.exec(bodyId)?.[1]?.toUpperCase();
  if (namedState && namedState !== state) return [];
  return (await query(HELD_MEMBER_IDENTITIES_SQL, [state, bodyId])).flatMap(row =>
    typeof row.id === "string" && row.id && typeof row.name === "string" && row.name.trim() && typeof row.person_id === "string" && row.person_id
      ? [{ id: row.id, name: row.name, personId: row.person_id }] : []);
}

/** A name is usable only within this exact body and with one native member and one canonical person. */
export function indexHeldMemberIdentities(rows: readonly HeldMemberIdentity[]): ReadonlyMap<string, HeldMemberIdentity | null> {
  const held = new Map<string, HeldMemberIdentity | null>();
  for (const row of rows) {
    const key = nameKey(row.name), prior = held.get(key);
    if (!key || held.has(key) && (prior === null || prior!.id !== row.id || prior!.personId !== row.personId)) held.set(key, null);
    else held.set(key, row);
  }
  return held;
}

/** Preserve both the native reader link and its canonical person before the ordinary roster publisher resolves its row. */
export async function bindHeldMemberIdentity(db: FactDb, input: { readonly identity: HeldMemberIdentity; readonly bodyId: string;
  readonly state: string | null }): Promise<boolean> {
  const { identity, bodyId, state } = input;
  const schemes = ["roster-member", `roster-name:${bodyId}`], values = [identity.id, nameKey(identity.name)];
  const read = (query: Query) => query(`SELECT DISTINCT x.entity_id FROM entity_external_id x
    JOIN unnest($1::text[],$2::text[]) w(scheme,value) ON x.scheme=w.scheme AND x.value=w.value`, [schemes, values]);
  try {
    return await db.transaction(async query => {
      if ((await read(query)).some(row => row.entity_id !== identity.personId)) return false;
      await ensureEntity(query, { id: identity.personId, kind: "person", name: identity.name, state, parentId: bodyId });
      if ((await query("SELECT kind FROM entity WHERE id=$1", [identity.personId]))[0]?.kind !== "person") return false;
      await query(`INSERT INTO entity_external_id (entity_id,scheme,value)
        SELECT $1,* FROM unnest($2::text[],$3::text[]) ON CONFLICT (scheme,value) DO NOTHING`, [identity.personId, schemes, values]);
      if ((await read(query)).some(row => row.entity_id !== identity.personId)) throw new Error("HELD_MEMBER_IDENTITY_CONFLICT");
      return true;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "HELD_MEMBER_IDENTITY_CONFLICT") return false;
    throw error;
  }
}
