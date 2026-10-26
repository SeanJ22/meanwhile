"use client";
import { useEffect,useState } from 'react';
import { useV6 } from './context.tsx';
import type { ScoreboardView } from './model.ts';
/** Hourly numbers refresh independently of weekly audits and place histories. */
export function useKeeperScoreboard():ScoreboardView|null {
  const v=useV6();const [first,setFirst]=useState<{data:ScoreboardView;asOf:string}|null>(null);
  useEffect(()=>{
    if(v.mode!=='live')return;
    const controller=new AbortController();
    const read=()=>void fetch('/api/admin/v6/scoreboard?reading=hourly&scope=us',{cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}})
      .then(async r=>r.ok?await r.json():null).then(r=>{if(r?.contract==='admin-v6/scoreboard@1')setFirst({data:r.data,asOf:r.asOf});}).catch(()=>undefined);
    read();
    const timer=setInterval(read,60_000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[v.mode]);
  const full=v.data.scoreboard;
  return first&&(!full.data||!full.asOf||Date.parse(first.asOf)>=Date.parse(full.asOf))?first.data:full.data;
}
