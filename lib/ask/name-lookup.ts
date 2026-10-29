import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { readKeyedRegistryBodyHeaders } from "../civic-data/keyed-rows.ts";
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
export const GOVERNMENT_NAME_HEADERS = `SELECT e.id,e.name,CASE WHEN parent.kind='place' THEN parent.id WHEN place.kind='place' THEN place.id END AS ocd_id,
  coalesce(parent.name,place.name) AS division_label,NULL::text AS alias_of FROM entity e LEFT JOIN entity parent ON parent.id=e.parent_id
  LEFT JOIN entity place ON place.id=parent.parent_id
  WHERE e.state=ANY($1::char(2)[]) AND e.kind IN ('body','government')
    AND ($2::text IS NULL OR concat_ws(' ',e.name,parent.name,place.name) ~* $2)
UNION ALL
SELECT alias.entity_id,NULL,NULL,NULL,alias.value FROM entity_external_id alias WHERE alias.scheme='body-alias' AND alias.value=ANY($3::text[])`;

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
  const pattern = school ? `(^|[^a-z])${school}[[:space:]]*school([^a-z]|$)` : null;
  const published = await readKeyedRegistryBodyHeaders(query, states, pattern);
  if (!published) return false;
  const held = await query(GOVERNMENT_NAME_HEADERS, [states, pattern, published.map(body => body.id)]);
  /* A published body folded into another answers as the body it was folded into. */
  const folded = new Map(held.filter(row => typeof row.alias_of === "string").map(row => [String(row.alias_of), String(row.id)]));
  const rows = [...held.filter(row => row.alias_of === null || row.alias_of === undefined),
    ...published.map(body => ({ id: folded.get(body.id) ?? body.id, name: body.name, ocd_id: body.ocdId }))];
  return !nameNeedsFullReader(question, rows);
}
