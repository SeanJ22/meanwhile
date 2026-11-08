"use client";
/** BR-27/28: live reports and the saved daily brief use the same three parts. */
import type { BriefReading, BriefSnapshot } from "@/lib/control-plane/admin-view/brief.ts";
import { plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { stateName } from "@/lib/facts/entity-read.ts";
import { countOwner } from "@/lib/counts/hour.ts";
import { isLineHealthKey } from "@/lib/control-plane/line-keeper/health.ts";
import { mst } from "./model.ts";
import { Card, Empty, Failed, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";
export function BriefParts({brief}:{readonly brief:BriefSnapshot}){
 const rank=(p:{key:string;group?:unknown})=>isLineHealthKey(p.key)?2:p.group?1:0;
 const shown=[...brief.problems].sort((a,b)=>rank(b)-rank(a)).slice(0,6);
 return <div className={s.stack}>
  <p className={`${s.meta} ${s.p}`}>Read {mst(brief.createdAt)}</p>
  {brief.unread.length>0&&<p role="status">Could not read: {brief.unread.join(", ")}. Those parts are unknown.</p>}
  <div className={s.briefGrid}>
  <Card title="Wins and updates">{brief.updates.length?<ul>{brief.updates.slice(0,3).map(u=><li key={u.id}><p>{plainWords(u.what)} <Pill tone={u.isWin?"good":"neutral"}>{u.label}</Pill></p><p className={s.meta}>{u.when}</p></li>)}</ul>:<Empty>No updates in this reading.</Empty>}{brief.updates.length>3&&<a href="/admin?view=history">All {brief.updates.length} updates →</a>}</Card>
  <Card title="Problems">{brief.problems.length?<ul className={s.briefProblems}>{shown.map(p=><li key={p.key}>
    <strong>{plainWords(p.what)}</strong>
    {p.group&&<p>{p.group.items?.toLocaleString("en-US")??"—"} items · {p.group.states.filter(row=>row.state!=="US").length} states and territories{p.group.states.some(row=>row.state==="US")?" · national work":""}</p>}
    {p.group&&<p className={s.meta}>{p.group.items===null?"Includes":"Largest"}: {p.group.states.slice(0,3).map((row,index)=><span key={row.state}>{index?" · ":""}<a href={`/admin?view=queue&scope=${row.state.toLowerCase()}&filter=waiting`}>{row.state==="US"?"National":stateName(row.state)??row.state} {row.items?.toLocaleString("en-US")??"—"}</a></span>)}</p>}
    <p className={s.meta}>{countOwner(plainWords(p.owner))} · {plainWords(p.next)}</p>
  </li>)}</ul>:<Empty>No problems in the parts read.</Empty>}
  {brief.problems.length>shown.length&&<p className={s.meta}>{brief.problems.length-shown.length} other problems in Queue.</p>}
  <a href="/admin?view=queue&filter=waiting">Every problem is in its state’s queue →</a></Card>
  <Card title="Decisions">{brief.decisions.length?brief.decisions.slice(0,3).map(c=><div key={c.key}><strong>{plainWords(c.what)}</strong><p>{plainWords(c.next)}</p></div>):<Empty>No decisions in this reading.</Empty>}{brief.decisions.length>0&&<a href="/admin?view=queue">See in Queue →</a>}</Card>
  </div>
 </div>;
}
export function BriefView(){
 const { reading, reload, status } = useReading<BriefReading>("/api/admin/v6/brief");
 return <section><header className={s.spread}><h1 className={s.h1}>Brief</h1><button type="button" className={s.btn} onClick={reload}>Pull a report</button></header>{status}
  {reading.kind==="loading"&&<Loading what="the brief"/>}{reading.kind==="failed"&&<Failed what="The brief" retry={reload}/>}
  {reading.kind==="ready"&&<>{reading.stale&&<p role="status">This is the earlier report; the latest read failed.</p>}<BriefParts brief={reading.data.fresh}/></>}
 </section>;
}
export function DailyBrief(){
 const { reading, reload, status } = useReading<{latest:BriefSnapshot|null}>("/api/admin/v6/daily-brief");
 return <Card title="Latest daily brief">{status}
  {reading.kind==="failed"&&<Failed what="The daily brief" retry={reload}/>}
  {reading.kind==="ready"&&reading.data.latest&&<BriefParts brief={reading.data.latest}/>}</Card>;
}
export function AlertStrip(){
 const { reading, status } = useReading<{on:boolean;alerts:BriefSnapshot["alerts"]}>("/api/admin/v6/alerts");
 // No alert appears before the owner turns on the setting. A failed refresh does not revive a stale switch.
 return <section>{status}{reading.kind==="ready"&&!reading.stale&&reading.data.on&&reading.data.alerts.length>0&&
  <aside className={s.banner} aria-label="Needs me"><ul>{reading.data.alerts.map(a=><li key={a.key}>{a.what} · {a.next}</li>)}</ul></aside>}</section>;
}
