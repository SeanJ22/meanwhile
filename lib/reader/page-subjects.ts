import type { Query } from "../facts/publish.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";

/** Registry-only boards already serve readers; give their existing identities their own body pages. */
export async function seedRuntimeBodyPageSubjects(query:Query,states:readonly string[]=REGISTRY_STATES):Promise<number> {
  let inserted=0;
  for(const state of states) {
    const [result]=await query(`WITH runtime AS (
      SELECT reader_payload_node(reader_payload_node(payload)->'registry') AS registry
      FROM civic_data_promotions WHERE record_class='REGISTRY_RUNTIME_BINDING'
        AND key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
    ), bodies AS (
      SELECT reader_payload_node(b.item) AS value FROM runtime r,LATERAL reader_payload_members(r.registry->'bodies') b
    ), seeded AS (
      INSERT INTO entity(id,kind,name,state,parent_id)
        SELECT coalesce(alias.entity_id,b.value->>'id'),'body',coalesce(b.value->>'name',b.value->>'id'),$1,parent.id
        FROM bodies b
        LEFT JOIN entity_external_id alias ON alias.scheme='body-alias' AND alias.value=b.value->>'id'
        LEFT JOIN entity canonical ON canonical.id=alias.entity_id
        LEFT JOIN entity parent ON parent.id=b.value->>'ocdId' AND parent.kind='place'
        WHERE nullif(b.value->>'id','') IS NOT NULL AND (alias.entity_id IS NULL OR canonical.state=$1::char(2))
        ORDER BY b.value->>'id' ON CONFLICT(id) DO NOTHING RETURNING id
    ) SELECT count(*)::int AS n FROM seeded`,[state]);
    inserted+=Number(result?.n ?? 0);
  }
  return inserted;
}

