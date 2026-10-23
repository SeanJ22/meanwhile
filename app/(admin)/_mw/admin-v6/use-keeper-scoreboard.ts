"use client";
import { useEffect,useState } from 'react';
import { useV6 } from './context.tsx';
import type { ScoreboardView } from './model.ts';
/** The hourly numbers must not wait for unrelated weekly audits and place histories.
 * This first read uses the existing endpoint; the existing pulse still owns refreshes. */
export function useKeeperScoreboard():ScoreboardView|null {
  const v=useV6();const [first,setFirst]=useState<ScoreboardView|null>(null);
  useEffect(()=>{
    if(v.mode!=='live')return;
    const controller=new AbortController();
    void fetch('/api/admin/v6/scoreboard?reading=hourly&scope=us',{signal:controller.signal,headers:{accept:'application/json'}})
      .then(async r=>r.ok?await r.json():null).then(r=>{if(r?.contract==='admin-v6/scoreboard@1')setFirst(r.data);}).catch(()=>undefined);
    return ()=>controller.abort();
  },[v.mode]);
  return v.data.scoreboard.data??first;
}
