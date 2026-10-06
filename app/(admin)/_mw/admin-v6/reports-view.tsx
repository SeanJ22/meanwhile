"use client";
/** BR-27/28: live reports and the saved daily brief use the same three parts. */
import type { BriefReading, BriefSnapshot } from "@/lib/control-plane/admin-view/brief.ts";
import { plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { decisionOrderAction } from "./decision-order-action.ts";
import { mst } from "./model.ts";
import { Actions, Card, Empty, Failed, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import { VitalSignsRow } from "./vital-signs.tsx";
import s from "./v6.module.css";
export function BriefParts({brief}:{readonly brief:BriefSnapshot}){
 return <div className={s.stack}>
  <p className={s.meta}>Read {mst(brief.createdAt)}</p>
  <VitalSignsRow row={brief.vitalSigns ?? null}/>
  {brief.unread.length>0&&<p role="status">Could not read: {brief.unread.join(", ")}. Those parts are unknown.</p>}
  <Card title="Wins and updates">{brief.updates.length?<ul>{brief.updates.map(u=><li key={u.id}><p>{u.what} <Pill tone={u.isWin?"good":"neutral"}>{u.label}</Pill></p><p className={s.meta}>{u.when}{u.before!==null?` · Before: ${u.before}`:""}{u.after!==null?` · After: ${u.after}`:""}</p></li>)}</ul>:<Empty>No updates in this reading.</Empty>}</Card>
  <Card title="Problems">{brief.problems.length?<ul>{brief.problems.map(p=><li key={p.key}><p>{p.what} · {p.owner} · {p.next}</p></li>)}</ul>:<Empty>No problems in the parts read.</Empty>}</Card>
  <Card title="Decisions">{brief.decisions.length?brief.decisions.map(c=><div key={c.id}><strong>{plainWords(c.recommends)}</strong><p>{plainWords(c.happening)}</p><p>Cost: {plainWords(c.cost)} · What it gets: {plainWords(c.gets)}</p><Actions actions={[decisionOrderAction(c)]}/></div>):<Empty>No decisions in this reading.</Empty>}</Card>
 </div>;
}
export function ReportsView(){
 const {reading,reload}=useReading<BriefReading>("/api/admin/v6/brief");
 return <><header><h1 className={s.h1}>Brief</h1><button type="button" className={s.btn} onClick={reload}>Pull a report</button></header>
  {reading.kind==="loading"&&<Loading what="the brief"/>}{reading.kind==="failed"&&<Failed what="The brief" retry={reload}/>}
  {reading.kind==="ready"&&<>{reading.stale&&<p role="status">This is the earlier report; the latest read failed.</p>}<BriefParts brief={reading.data.fresh}/></>}
 </>;
}
export function DailyBrief(){
 const {reading,reload}=useReading<{latest:BriefSnapshot|null}>("/api/admin/v6/daily-brief");
 if(reading.kind==="loading")return null;
 if(reading.kind==="failed")return <Failed what="The daily brief" retry={reload}/>;
 if(!reading.data.latest)return null;
 return <Card title="Latest daily brief">{reading.stale&&<p role="status">The latest read failed; this is the earlier daily brief.</p>}<BriefParts brief={reading.data.latest}/></Card>;
}
export function AlertStrip(){
 const {reading}=useReading<{on:boolean;alerts:BriefSnapshot["alerts"]}>("/api/admin/v6/alerts",60_000);
 // No alert appears before the owner turns on the setting. A failed refresh does not revive a stale switch.
 if(reading.kind!=="ready"||reading.stale||!reading.data.on||!reading.data.alerts.length)return null;
 return <aside className={s.banner} aria-label="Needs me"><ul>{reading.data.alerts.map(a=><li key={a.key}>{a.what} · {a.next}</li>)}</ul></aside>;
}
