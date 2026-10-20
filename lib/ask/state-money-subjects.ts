import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { factReader } from "../facts/db.ts";
import { CAMPAIGN_PEOPLE_SQL } from "../funding/state-people.ts";
import { moneyQuestionShape, raceWordsFitOffice } from "./money-answer.ts";

export function selectStateMoneyNames(question: string): string[] {
  const shape = moneyQuestionShape(question);
  const names = shape ? [shape.slot, ...shape.otherSlot ? [shape.otherSlot] : []] : [];
  for (const name of names) if (normalizeName(name).split(" ").length >= 2) {
    currentReaderSelection()?.keys.add(`ask-money-name:${normalizeName(name)}`);
  }
  return names;
}

export async function requestedStateMoneySubjects(question: string, states: readonly string[]): Promise<(BindableEntity & { officeTitle: string | null })[]> {
  const names = selectStateMoneyNames(question),query=factReader();
  if (!names.length || !query) return [];
  const tokens=[...new Set(names.flatMap(name=>normalizeName(name).split(" ")).filter(Boolean))];
  const race = moneyQuestionShape(question)?.raceWords;
  const entities = new Map<string, BindableEntity & { officeTitle: string | null }>(),withMoney=new Set<string>();
  for(const state of new Set(states)){
    const rows=await query(`WITH published AS MATERIALIZED (${CAMPAIGN_PEOPLE_SQL})
      SELECT DISTINCT p.id,p.name,p.office,m.id AS money_id FROM published p
      LEFT JOIN LATERAL (
        SELECT e.id FROM entity e WHERE e.state=$2 AND e.kind='person' AND e.name=p.name
          AND (e.id=p.id OR p.aliases?e.id OR EXISTS(SELECT 1 FROM entity_external_id x WHERE x.entity_id=e.id
            AND x.scheme='campaign-person:'||$2 AND (x.value=p.id OR p.aliases?x.value)))
          AND EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=e.id AND f.field LIKE 'campaign-cycle:%' AND f.status='live'
            AND f.value#>>'{person,name}'=p.name AND (f.value->>'cycle')::int>=2020)
        ORDER BY e.id LIMIT 1
      ) m ON true WHERE regexp_split_to_array(lower(p.name),'[^[:alnum:]]+') && $3::text[]`,[`US-${state}`,state,tokens]);
    for(const row of rows){
      if(race && !raceWordsFitOffice(race,String(row.office??"")))continue;
      const id=String(row.money_id??row.id);
      if(row.money_id)withMoney.add(id);
      entities.set(id,{id,name:String(row.name),nameClass:"person",divisionType:"person",officeTitle:row.office===null?null:String(row.office)});
    }
  }
  const selected = new Map<string, BindableEntity & { officeTitle: string | null }>();
  for (const name of names) {
    const binding = bindNamedEntity(name, [...entities.values()]);
    if (binding.kind !== "BOUND" || !withMoney.has(binding.entity.id)) return [];
    selected.set(binding.entity.id, entities.get(binding.entity.id)!);
  }
  return [...selected.values()];
}
