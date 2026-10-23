"use client";

import { useState } from "react";
import type { OwnerFlag, FlagChoice, PublishedFactMatch } from "@/lib/facts/owner-flags.ts";
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

function FlagSearch({reload}:{readonly reload:()=>void}) {
  const [words,setWords] = useState("");
  const [found,setFound] = useState<{matches:PublishedFactMatch[];more:boolean}|null>(null);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const search = async () => {
    setBusy(true);setMessage("");
    try {
      const response = await fetch(`/api/admin/v6/fact-search?q=${encodeURIComponent(words.trim())}`,{cache:"no-store",headers:{accept:"application/json"}});
      const body = await response.json();
      if (!response.ok) throw new Error(body.says ?? "Type at least three letters of a name.");
      setFound(body);
    } catch(error) {setFound(null);setMessage(error instanceof Error ? error.message : "The search could not be run.");}
    finally {setBusy(false);}
  };
  const flag = async (match:PublishedFactMatch) => {
    setBusy(true);setMessage("");
    try {
      const response = await fetch("/api/admin/action",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},
        body:JSON.stringify({type:"fact.flag.raise",subject:String(match.factId),idempotencyKey:crypto.randomUUID(),input:{factId:match.factId}})});
      const result = await response.json();
      if (!response.ok || result.ok === false || result.receipt?.outcome === "REFUSED" || result.outcome === "REFUSED") throw new Error(result.says ?? result.receipt?.says ?? "The flag could not be saved.");
      setFound(found && {...found,matches:found.matches.map(row=>row.factId===match.factId?{...row,flagged:true}:row)});
      setMessage("Flagged. It is in your flags below.");reload();
    } catch(error) {setMessage(error instanceof Error ? error.message : "The flag could not be saved.");}
    finally {setBusy(false);}
  };
  return <article className={s.card}>
    <strong>Flag a published fact</strong>
    <form onSubmit={event=>{event.preventDefault();void search();}}>
      <label className={s.small}>Name of the person, board or place<input className={s.input} value={words} onChange={event=>setWords(event.target.value)}/></label>
      <button className={s.btn} disabled={busy||words.trim().length<3}>Find</button>
    </form>
    {found && !found.matches.length && <p className={s.small}>Nothing published under that name.</p>}
    {found?.matches.map(match=><div key={match.factId} className={s.row}>
      <p className={s.small}><strong>{match.title} — {match.what}: </strong>{match.value}</p>
      {match.sourceUrl && <a href={match.sourceUrl} target="_blank" rel="noreferrer">Read the source</a>}
      <button className={s.btn} disabled={busy||match.flagged} onClick={()=>void flag(match)}>{match.flagged ? "Flagged" : "Flag it"}</button>
    </div>)}
    {found?.more && <p className={s.small}>More matches exist. Type more of the name.</p>}
    {message && <p role="status">{message}</p>}
  </article>;
}

export function AuditFlagsPanel() {
  const {mode} = useV6();
  const [after,setAfter] = useState("0");
  const {reading,reload} = useReading<{flags:OwnerFlag[];next:string|null}>(`/api/admin/v6/fact-flags?after=${after}`);
  if (mode !== "live") return null;
  const flags = reading.kind === "ready" ? reading.data : null;
  return <section aria-label="Published fact flags" className={s.stack}>
    <h2>Published fact flags</h2>
    <FlagSearch reload={reload}/>
    {reading.kind === "failed" && <p className={s.why}>Published fact flags could not be read.</p>}
    {flags?.flags.map(flag=><FlagCard key={flag.id} flag={flag} reload={reload}/>)}
    {flags?.next && <button className={s.btn} onClick={()=>setAfter(flags.next!)}>More flags</button>}
  </section>;
}
