"use client";
import type { DecisionOrderCard, DecisionOrdersView } from "@/lib/control-plane/decision-cards.ts";
import { useReading } from "./use-reading.ts";
import { useV6 } from "./context.tsx";
import { mst } from "./model.ts";
import { Actions, Card, Facts, Pill } from "./ui.tsx";
import s from "./v6.module.css";
import type { ActionRef } from "./model.ts";
/** The preview carries the exact card version. The server re-reads it before sending. */
export function decisionOrderAction(card:DecisionOrderCard):ActionRef {
 return {kind:"decide",target:card.id,label:"Decide",payload:{name:card.recommends,happening:card.happening,recommends:card.recommends,cost:card.cost,gets:card.gets,version:card.version,
  global:card.order.subject==="us"?"true":"false",schedulable:card.schedulable?"true":"false",
  fields:JSON.stringify(card.fields.map(field=>({...field,initial:String(card.order.input[field.key]??"")})))}};
}
export function DecisionOrdersPanel(){
 const v=useV6();const {reading,reload}=useReading<DecisionOrdersView>("/api/admin/v6/decisions",20_000);
 const cards=reading.kind==="ready"?reading.data.cards:[];
 if(reading.kind === "failed") return <Card title="Decisions"><p>The decision cards could not be read just now.</p><button type="button" className={s.btn} onClick={reload}>Try again</button></Card>;
 if(!cards.length)return null;
 return <Card title="Needs me"><div className={s.stack}>{cards.map(card=><div key={card.id} className={s.row}>
  <div className={s.spread}><strong>{card.recommends}</strong><Pill tone={card.resolution?"neutral":"warn"}>{card.resolution?card.resolution.choice==="decline"?"Declined":"Now an order":"Needs me"}</Pill></div>
  <Facts rows={[["What is happening",card.happening],["Cost",card.cost],["What it gets",card.gets]]}/>
  {card.resolution?<><p>{card.resolution.reason ?? (card.resolution.receiptId ? "The recommended order was accepted." : "No order was sent.")} · {mst(card.resolution.at)}</p><button className={s.btn} type="button" onClick={()=>v.go("work")}>See orders</button></>:<Actions actions={[decisionOrderAction(card)]} primaryFirst/>}
 </div>)}</div></Card>;
}
