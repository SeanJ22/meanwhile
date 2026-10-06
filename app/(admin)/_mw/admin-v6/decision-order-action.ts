import type { DecisionOrderCard } from "../../../../lib/control-plane/decision-cards.ts";
import type { ActionRef } from "./model.ts";
/** The preview carries the exact card version. The server re-reads it before sending. */
export function decisionOrderAction(card:DecisionOrderCard):ActionRef {
 return {kind:"decide",target:card.id,label:"Decide",payload:{name:card.recommends,happening:card.happening,recommends:card.recommends,cost:card.cost,gets:card.gets,version:card.version,
  global:card.order.subject==="us"?"true":"false",schedulable:card.schedulable?"true":"false",
  fields:JSON.stringify(card.fields.map(field=>({...field,initial:String(card.order.input[field.key]??"")})))}};
}
