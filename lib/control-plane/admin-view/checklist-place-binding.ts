import { isExpansionScopeDecision, scopeKeyOf, validateScopeGeography, VERSION_PREFIX,
  type ExpansionScopeType } from "../expansion/scopes.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { Sql } from "../repository/pg-store.ts";

const SHORT_TYPES: Readonly<Record<string, ExpansionScopeType>> = {
  zcta: "zcta", county: "county", cd: "congressional_district", cbsa: "cbsa",
  sldu: "state_leg_upper", sldl: "state_leg_lower",
};
export type ChecklistPlaceBinding = { readonly state: "BOUND"; readonly placeKey: string;
  readonly scopeId: string; readonly instructionReceipt: string; readonly decidedAt: string;
  readonly authority: "SAVED_LIFETIME_HUNT_DECISION" };
export type ChecklistPlaceBindingFailure = { readonly state: "UNAVAILABLE";
  readonly code: "INVALID_PLACE_KEY" | "DECISION_NOT_RECORDED" | "DECISION_MALFORMED" |
    "AMBIGUOUS_PLACE" | "NOT_SAVED_LIFETIME_HUNT" };
export type ChecklistPlaceBindingRead = ChecklistPlaceBinding | ChecklistPlaceBindingFailure;

/** The Admin filter's exact `state.shortType.geoid` grammar. A bare state,
 * postcode or publisher label cannot manufacture a saved instruction. */
export function parseChecklistPlaceKey(value: string): { readonly state: string;
  readonly type: ExpansionScopeType; readonly geoid: string } | null {
  const match=/^([a-z]{2})\.(zcta|county|cd|cbsa|sldu|sldl)\.([0-9a-z]{2,12})$/.exec(value);
  if(!match || (match[2]==="zcta" && !/^\d{5}$/.test(match[3]!))) return null;
  return {state:match[1]!,type:SHORT_TYPES[match[2]!]!,geoid:match[3]!};
}

/** Only the exact current owner decision can bind a UI place to a checklist
 * scope. Editing a lifetime hunt's priority changes latestDecisionReceiptId,
 * while receiptId remains the original instruction receipt. */
export function resolveChecklistPlaceBinding(placeKey: string, saved: readonly unknown[]): ChecklistPlaceBindingRead {
  const place=parseChecklistPlaceKey(placeKey);
  if(!place) return {state:"UNAVAILABLE",code:"INVALID_PLACE_KEY"};
  if(saved.length>1) return {state:"UNAVAILABLE",code:"AMBIGUOUS_PLACE"};
  if(saved.length===0) return {state:"UNAVAILABLE",code:"DECISION_NOT_RECORDED"};
  const candidate=saved[0];
  if(!isExpansionScopeDecision(candidate)) return {state:"UNAVAILABLE",code:"DECISION_MALFORMED"};
  const geo=validateScopeGeography(candidate.geography as unknown as Readonly<Record<string,unknown>>);
  if(!geo.ok || geo.value.type!==place.type || geo.value.geoid.toLowerCase()!==place.geoid ||
    geo.value.stateAbbr.toLowerCase()!==place.state ||
    candidate.key!==scopeKeyOf(candidate.geography) ||
    !candidate.key.startsWith(`${VERSION_PREFIX[place.type]}:`))
    return {state:"UNAVAILABLE",code:"DECISION_MALFORMED"};
  if(candidate.sourceWorkVersion!==1 || !candidate.budgetStartedAt ||
    !Number.isFinite(Date.parse(candidate.budgetStartedAt)) ||
    !Number.isFinite(Date.parse(candidate.decidedAt)) ||
    Date.parse(candidate.decidedAt)<Date.parse(candidate.budgetStartedAt) ||
    !candidate.receiptId.trim() || candidate.receiptId!==candidate.receiptId.trim() ||
    /[\u0000-\u001f]/.test(candidate.receiptId))
    return {state:"UNAVAILABLE",code:"NOT_SAVED_LIFETIME_HUNT"};
  return {state:"BOUND",placeKey,scopeId:candidate.key,instructionReceipt:candidate.receiptId,
    decidedAt:candidate.decidedAt,authority:"SAVED_LIFETIME_HUNT_DECISION"};
}

/** One policy-row point read, with at most two matching decisions transferred.
 * The second is an ambiguity witness; no broad owner snapshot is loaded. */
export const CHECKLIST_PLACE_DECISION_SQL = `SELECT value->>'formatVersion' AS format_version,
  jsonb_typeof(value->'expansionScopes') AS scopes_shape,
  (SELECT jsonb_agg(found.entry) FROM (
    SELECT entry FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value->'expansionScopes') = 'array'
      THEN value->'expansionScopes' ELSE '[]'::jsonb END) AS item(entry)
    WHERE lower(entry->'geography'->>'stateAbbr') = $1
      AND lower(entry->'geography'->>'geoid') = $2
      AND entry->'geography'->>'type' = $3
    LIMIT 2
  ) AS found) AS matches FROM cp_admin_config WHERE id = 'current'`;

export async function readChecklistPlaceBinding(sql: Sql, placeKey: string): Promise<ChecklistPlaceBindingRead> {
  const place=parseChecklistPlaceKey(placeKey);
  if(!place) return {state:"UNAVAILABLE",code:"INVALID_PLACE_KEY"};
  const rows=await boundedQuery(sql,{operation:"cp_admin_config.checklist_place_decision",callClass:"POINT"},
    CHECKLIST_PLACE_DECISION_SQL,[place.state,place.geoid,place.type]) as readonly {
      readonly format_version?:unknown;readonly scopes_shape?:unknown;readonly matches?:unknown }[];
  if(rows.length!==1 || rows[0]?.format_version!=="1" || rows[0]?.scopes_shape!=="array")
    return {state:"UNAVAILABLE",code:"DECISION_MALFORMED"};
  const matches=rows[0].matches;
  if(matches!==null && !Array.isArray(matches)) return {state:"UNAVAILABLE",code:"DECISION_MALFORMED"};
  return resolveChecklistPlaceBinding(placeKey,matches??[]);
}
