import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { decideNamedBody } from "./body-confirmation.ts";
import { COMMON_QUESTION_NOUNS, distinctiveTokens, nameAReaderCanSay, type BindableEntity } from "../routing/named-entity.ts";

/** A name typed into search, rather than a request about that government. */
export function bareGovernmentName(question: string): boolean {
  if (question.length > 140 || /[?\n]/.test(question) ||
    /\b(?:who|what|when|where|why|how|can|could|would|should|will|did|does|do|is|are|was|were|my|our|your|contact|find|show|list|tell|funding|budget|agenda|meeting|minutes|votes?|voted)\b/i.test(question)) return false;
  if (!/\b(?:high\s*school|middle\s*school|elementary\s*school|school|district|council|commission|department|authority|board|board of (?:education|supervisors|trustees)|city hall)\s*$/i.test(question)) return false;
  return distinctiveTokens(question).some(word => word.length > 2 && !COMMON_QUESTION_NOUNS.has(word));
}

/** Only identity headers leave Postgres. Calendar, people and ballot payloads stay there. */
export const GOVERNMENT_NAME_HEADERS = `WITH runtime AS (
  SELECT reader_payload_node(reader_payload_node(payload)->'registry') AS registry
    FROM civic_data_promotions WHERE record_class='REGISTRY_RUNTIME_BINDING' AND scope=ANY($1::text[])
), published AS (
  SELECT reader_payload_node(b.item) AS body FROM runtime r,LATERAL reader_payload_members(r.registry->'bodies') b
)
SELECT coalesce(alias.entity_id,body->>'id') AS id,body->>'name' AS name,body->>'ocdId' AS ocd_id,
  NULL::text AS division_label FROM published
  LEFT JOIN entity_external_id alias ON alias.scheme='body-alias' AND alias.value=body->>'id'
  WHERE $3::text IS NULL OR body->>'name' ~* $3
UNION ALL
SELECT e.id,e.name,CASE WHEN parent.kind='place' THEN parent.id WHEN place.kind='place' THEN place.id END,
  coalesce(parent.name,place.name) FROM entity e LEFT JOIN entity parent ON parent.id=e.parent_id
  LEFT JOIN entity place ON place.id=parent.parent_id
  WHERE e.state=ANY($2::char(2)[]) AND e.kind IN ('body','government')
    AND ($3::text IS NULL OR concat_ws(' ',e.name,parent.name,place.name) ~* $3)`;

/** A possible exact, fuzzy or ambiguous match keeps the ordinary full reader path. */
export function nameNeedsFullReader(question: string, rows: readonly Record<string, unknown>[]): boolean {
  const name = question.replace(/\b(high|middle|elementary)school\b/gi, "$1 school");
  const school = /\b(high|middle|elementary)\s+school\s*$/i.exec(name)?.[1];
  const bodies: BindableEntity[] = rows.filter(row => typeof row.id === "string" && typeof row.name === "string")
    .map((row): BindableEntity => ({ id: String(row.id), name: nameAReaderCanSay(String(row.name), typeof row.division_label === "string" ? row.division_label : null),
      nameClass: "body", level: "BODY", ocdId: typeof row.ocd_id === "string" ? row.ocd_id : null,
      divisionType: typeof row.ocd_id === "string" ? row.ocd_id.split("/").at(-1)?.split(":")[0] : null }))
    .filter(row => !school || new RegExp(`\\b${school}\\s*school\\b`, "i").test(row.name));
  const decision = decideNamedBody(name, bodies, undefined, [name]);
  return decision.kind === "BOUND" || decision.kind === "CONFIRM";
}

export async function bareNameIsUnheld(question: string, states: readonly string[], query: Query | null = currentReaderAuthorityEdge() ? null : factReader()): Promise<boolean> {
  if (currentReaderAuthorityEdge() || !bareGovernmentName(question) || !states.length || !query) return false;
  const school = /\b(high|middle|elementary)\s*school\s*$/i.exec(question)?.[1];
  const rows = await query(GOVERNMENT_NAME_HEADERS, [states.map(stateRegistryRuntimeScope), states,
    school ? `(^|[^a-z])${school}[[:space:]]*school([^a-z]|$)` : null]);
  return !nameNeedsFullReader(question, rows);
}
