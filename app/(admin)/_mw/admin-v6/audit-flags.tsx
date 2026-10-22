"use client";

import { useState } from "react";
import type { OwnerFlag, FlagChoice } from "@/lib/facts/owner-flags.ts";
import { useReading } from "./use-reading.ts";
import { useV6 } from "./context.tsx";
import { Technical } from "./ui.tsx";
import s from "./v6.module.css";

const label = (field: string) => field.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[._:]/g," ");
function fieldsOf(flag: OwnerFlag): [string,unknown][] {
  if (flag.factId !== null) return flag.value && typeof flag.value === "object" && !Array.isArray(flag.value)
    ? Object.entries(flag.value).filter(([,value])=>typeof value === "string" || typeof value === "number").map(([field,value])=>[`value.${field}`,value])
    : [["value",flag.value]];
  const skip = new Set(["id","kind","bodyId","ocdId","officeholderId","officeKind","sourceUrl","sourceOrg","collectedAt","verifiedAt","commentPeriod","state"]);
  return Object.entries(flag.value as Record<string,unknown>).flatMap(([field,value]): [string,unknown][] => {
    if (skip.has(field)) return [];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [[field,value]];
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).flatMap(([key,inner]) =>
      typeof inner === "string" || typeof inner === "number" ? [[`${field}.${key}`,inner] as [string,unknown]] : []);
    return [];
  });
}

function FlagCard({flag,reload}:{readonly flag:OwnerFlag;readonly reload:()=>void}) {
  const fields = fieldsOf(flag);
  const [editing,setEditing] = useState(false);
  const [values,setValues] = useState<Record<string,string>>({});
  const [sourceUrl,setSourceUrl] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const answer = async (choice:FlagChoice) => {
    setBusy(true);setMessage("");
    try {
      const changed = Object.fromEntries(Object.entries(values).map(([field,text]) => {
        const original = fields.find(([key])=>key===field)?.[1];
        return [field,typeof original === "number" ? Number(text) : typeof original === "boolean" ? text === "true" : text];
      }));
      const response = await fetch("/api/admin/action",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},
        body:JSON.stringify({type:"fact.flag.answer",subject:flag.id,idempotencyKey:crypto.randomUUID(),input:{id:flag.id,choice,values:changed,sourceUrl}})});
      const result = await response.json();
      if (!response.ok || result.ok === false || result.receipt?.outcome === "REFUSED" || result.outcome === "REFUSED") throw new Error(result.says ?? result.receipt?.says ?? "The answer could not be applied.");
      setMessage("Answer saved.");reload();
    } catch(error) {setMessage(error instanceof Error ? error.message : "The answer could not be applied.");}
    finally {setBusy(false);}
  };
  return <article className={s.card}>
    <strong>{flag.title}</strong>
    <p className={s.small}>{flag.reason}</p>
    {fields.map(([field,value])=><p key={field} className={s.small}><strong>{label(field === "value" ? flag.field ?? field : field.replace(/^value\./,""))}: </strong>{String(value)}</p>)}
    {flag.sourceUrl && <a href={flag.sourceUrl} target="_blank" rel="noreferrer">Read the source</a>}
    <div className={s.row}>
      <button className={s.btn} disabled={busy} onClick={()=>void answer("REMOVE")}>Remove it</button>
      <button className={s.btn} disabled={busy} onClick={()=>void answer("KEEP")}>Keep it</button>
      <button className={s.btn} disabled={busy} onClick={()=>void answer("SEND_FLEET")}>Send the fleet</button>
      <button className={s.btn} disabled={busy} onClick={()=>setEditing(!editing)}>Type the right value</button>
    </div>
    {editing && <form onSubmit={event=>{event.preventDefault();void answer("TYPED_VALUE");}}>
      {fields.map(([field,value])=><label className={s.small} key={field}>{label(field === "value" ? flag.field ?? field : field.replace(/^value\./,""))}<input className={s.input} value={values[field]??String(value)} onChange={event=>setValues({...values,[field]:event.target.value})}/></label>)}
      <label className={s.small}>Source link (optional)<input className={s.input} type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)}/></label>
      <button className={s.btn} disabled={busy||!Object.keys(values).length}>Publish my correction</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <Technical lines={[`Flag ${flag.id}`,flag.reason]}/>
  </article>;
}

export function AuditFlagsPanel() {
  const {mode} = useV6();
  const [after,setAfter] = useState("0");
  const {reading,reload} = useReading<{flags:OwnerFlag[];next:string|null}>(`/api/admin/v6/fact-flags?after=${after}`);
  if (mode !== "live") return null;
  if (reading.kind === "failed") return <p className={s.why}>Published fact flags could not be read.</p>;
  if (reading.kind !== "ready" || !reading.data.flags.length) return null;
  return <section aria-label="Published fact flags" className={s.stack}>
    <h2>Published fact flags</h2>
    {reading.data.flags.map(flag=><FlagCard key={flag.id} flag={flag} reload={reload}/>)}
    {reading.data.next && <button className={s.btn} onClick={()=>setAfter(reading.data.next!)}>More flags</button>}
  </section>;
}
