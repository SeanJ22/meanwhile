"use client";
import { useState } from "react";
import type { HourlyCountTableData } from "./model.ts";
import { countLabel as words } from "../../../../lib/counts/labels.ts";
import { Card } from "./ui.tsx";
import { formatEastern } from "../../../../lib/control-plane/eastern-time.ts";
import s from "./v6.module.css";
const n=(value:number)=>value.toLocaleString("en-US");
const hourLabel=(at:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(at));
export function HourlyCounts({data}:{readonly data:HourlyCountTableData}) {
  const [selectedHour,setHour]=useState(data.hours[0]?.from??"");
  const [state,setState]=useState("");
  const [family,setFamily]=useState("");
  const [stage,setStage]=useState("fact:live");
  const hour=data.hours.find(h=>h.from===selectedHour)??data.hours[0];
  const families=[...new Set(data.hours.flatMap(h=>h.counts?.map(c=>c.family)??[]))].sort();
  const stages=[...new Set(["fact:live",...data.hours.flatMap(h=>h.counts?.map(c=>c.stage)??[])])].sort();
  return <Card title="Hourly counts">
    <p className={s.meta}>{data.status}</p>
    <div className={s.row}>
      <label>Hour <select className={s.select} aria-label="Count hour" value={hour?.from??""} onChange={e=>setHour(e.target.value)}>
        {data.hours.map(h=><option key={h.from} value={h.from}>{hourLabel(h.from)}</option>)}
      </select></label>
      <label>State <select className={s.select} aria-label="Count state" value={state} onChange={e=>setState(e.target.value)}>
        <option value="">All states</option>{data.states.map(code=><option key={code}>{code}</option>)}
      </select></label>
      <label>Kind <select className={s.select} aria-label="Count family" value={family} onChange={e=>setFamily(e.target.value)}>
        <option value="">All kinds</option>{families.map(f=><option key={f} value={f}>{words(f)}</option>)}
      </select></label>
      <label>Step <select className={s.select} aria-label="Count step" value={stage} onChange={e=>setStage(e.target.value)}>
        {stages.map(step=><option key={step} value={step}>{words(step)}</option>)}
      </select></label>
    </div>
    {hour?.counts?.some(c=>c.incoming===null)&&<p className={s.meta}>Hourly movement will show after the first full hour of counting.</p>}
    {hour&&<p className={s.meta}>Waiting times checked {formatEastern(hour.measuredAt)}.</p>}
    <div className={s.tableWrap}><table className={s.table}>
      <thead><tr><th scope="col">State</th><th scope="col">Now</th><th scope="col">At end of hour</th><th scope="col">In</th><th scope="col">Moved on</th><th scope="col">Updated</th><th scope="col">Oldest work waiting</th></tr></thead>
      <tbody>{data.states.filter(code=>!state||code===state).map(code=>{
        const rows=hour?.counts?.filter(c=>c.state===code&&c.stage===stage&&(!family||c.family===family));
        const waiting=hour?.waiting?.filter(w=>w.state===code&&w.count>0);
        const oldest=waiting?.filter(w=>w.oldestAt).sort((a,b)=>a.oldestAt!.localeCompare(b.oldestAt!))[0];
        const value=(field:"total"|"closedTotal"|"incoming"|"outgoing"|"changed")=>rows===undefined||rows.some(c=>c[field]===null)?"—":n(rows.reduce((sum,c)=>sum+c[field]!,0));
        return <tr key={code}><th scope="row">{code}</th><td>{value("total")}</td><td>{value("closedTotal")}</td><td>{value("incoming")}</td><td>{value("outgoing")}</td><td>{value("changed")}</td>
          <td>{waiting===undefined?"—":oldest?`${formatEastern(oldest.oldestAt!)} · ${n(Math.max(0,Math.floor((Date.parse(data.at)-Date.parse(oldest.oldestAt!))/60_000)))} minutes`:waiting.length?"—":"None"}</td></tr>;
      })}</tbody>
    </table></div>
  </Card>;
}
