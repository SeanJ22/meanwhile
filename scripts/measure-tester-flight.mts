/** Same instrument for V94's first and repeat application flights. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchGuarded } from "./browser.mts";
import { GPU_ARGS } from "../lib/ops/flyin-normalized.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://127.0.0.1:3244";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const label = process.argv[2] ?? "before";
const output = `.scratch/tester-flight-${label}.json`;
mkdirSync(".scratch", { recursive: true });
const probe = String.raw`(() => {
  const p = window.__testerFlight = {flights:[], commits:[], requests:[], mutations:[], callbacks:{}, active:null};
  const clock = () => performance.now();
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber:true, renderers:new Map(), inject(renderer){ this.renderers.set(1,renderer); return 1; },
    onCommitFiberRoot(id, root){
      const walk = fiber => {
        if (!fiber) return;
        const name = fiber.type?.displayName || fiber.type?.name;
        if (['MapCanvas','MapEntry','StateFocusOverlay','CoverageNotice'].includes(name)) {
          const changed=[]; let state=fiber.memoizedState, old=fiber.alternate?.memoizedState, index=0;
          while (state && index < 100) { if (!old || state.memoizedState !== old.memoizedState) changed.push(index); state=state.next;old=old?.next;index++; }
          if(changed.length) p.commits.push({at:clock(), name, hooks:changed});
        }
        walk(fiber.child); walk(fiber.sibling);
      };
      walk(root.current);
    }, onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}
  };
  const fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = String(typeof input === 'string' ? input : input?.url || input);
    const requestUrl = new URL(url, location.href);
    const request = {url:requestUrl.pathname, start:clock(), end:null}; p.requests.push(request);
    try {return await fetch.call(this,input,init);} finally {request.end=clock();}
  };
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      for(const flight of p.flights) if(e.startTime>=flight.start && e.startTime<=(flight.end??Infinity)) flight.longTasks.push({at:e.startTime,ms:e.duration});
    }
  }).observe({type:'longtask', buffered:true});
  const mutations = new MutationObserver(records => {
    const relevant=records.filter(r => r.target instanceof Element && (r.target.closest('.state-focus-layer') || r.target.closest('[data-coverage-notice]')));
    if(relevant.length) p.mutations.push({at:clock(), count:relevant.length});
  });
  document.addEventListener('DOMContentLoaded',()=>mutations.observe(document.documentElement,{subtree:true,attributes:true,childList:true}));
  let map;
  const attach = value => {
    map=value; if (!map) return;
    const originalFire=map.fire;
    map.fire=function(event,...args){
      const type=typeof event==='string'?event:event.type;
      const measured=['move','zoom','render','moveend','idle'].includes(type);
      const at=clock();
      if(measured) {
        const key=p.active?'motion':'settled';
        const bucket=p.callbacks[key]??=( {} );
        const entry=bucket[type]??={count:0,ms:0,names:[]};
        entry.count++;
        for(const fn of (this._listeners?.[type]??[])) {
          const name=fn.name || String(fn).replace(/\s+/g,' ').slice(0,100);
          if(!entry.names.includes(name)) entry.names.push(name);
        }
      }
      const result=originalFire.call(this,event,...args);
      if(measured) {
        const key=(p.active || (type==='moveend'&&p.flights.at(-1)?.end===at))?'motion':'settled';
        const bucket=p.callbacks[key]; if(bucket?.[type]) bucket[type].ms+=clock()-at;
      }
      return result;
    };
    for(const method of ['addLayer','removeLayer','addSource','setLayoutProperty','setPaintProperty','setFilter','setFeatureState','queryRenderedFeatures']) {
      const original=map[method];
      map[method]=function(...args) {
        const at=clock(); const result=original.apply(this,args);
        const id=typeof args[0]==='string'?args[0]:args[0]?.id;
        if(p.active) p.active.work.push({at,method,id:id??null,ms:clock()-at});
        return result;
      };
    }
    map.on('movestart',()=>{
      const flight={start:clock(),end:null,idle:null,frames:[],longTasks:[],work:[],layerStart:map.getStyle()?.layers.map(l=>({id:l.id,visibility:map.getLayoutProperty(l.id,'visibility')}))};
      p.flights.push(flight);p.active=flight;
      let last=clock();
      const frame=t=>{if(p.active!==flight)return;flight.frames.push(t-last);last=t;requestAnimationFrame(frame);};
      requestAnimationFrame(frame);
    });
    map.on('moveend',()=>{if(p.active){p.active.end=clock();p.active=null;}});
    map.on('idle',()=>{const last=p.flights.at(-1);if(last&&!last.idle)last.idle=clock();});
  };
  setInterval(()=>{if(window.__wtpMap && window.__wtpMap!==map)attach(window.__wtpMap);},10);
})();`;

const browser = await launchGuarded({ label: `tester-flight-${label}`, args: GPU_ARGS });
try {
  // Compile dev routes once, outside the fresh visitor measurement.
  const warm = await browser.page();
  await warm.goto(base, { waitUntil: "networkidle", timeout: 120_000 });
  await warm.request.get(`${base}/api/meetings?lat=32.21696&lng=-110.971&zip=85701`);
  await warm.close();
  const context = await browser.context({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  await context.addInitScript(probe);
  await context.addInitScript("localStorage.setItem('wtp.tutorial_seen','1');localStorage.setItem('wtp.theme','dark');");
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction("window.__wtpMap?.getStyle()?.layers?.length>1", null, {timeout:90_000});
  await page.waitForTimeout(500);
  const digits = page.locator('[aria-label="Choose a location"] input');
  const inputCount = await digits.count();
  if (inputCount===5) { for(const [i,d] of [...'85701'].entries()) await digits.nth(i).fill(d); }
  else await digits.first().fill('85701');
  await page.locator('.welcome-submit').click();
  await page.waitForFunction("window.__testerFlight.flights.some(f=>f.end && f.end-f.start>1000)", null, { timeout: 90_000 });
  await page.waitForFunction("!window.__wtpMap.isMoving()", null, { timeout: 90_000 });
  await page.waitForTimeout(2500);
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.evaluate("void window.__wtpMap.jumpTo({center:[-98.5,39.5],zoom:3.2})");
    await page.waitForFunction("!window.__wtpMap.isMoving()", null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.evaluate("void window.__wtpMap.flyTo({center:[-110.9747,32.2226],zoom:11,duration:2600,essential:true,curve:1.5})");
    await page.waitForTimeout(3200);
    await page.waitForFunction("!window.__wtpMap.isMoving()", null, { timeout: 60_000 });
  }
  const raw = await page.evaluate("JSON.parse(JSON.stringify(window.__testerFlight))") as {
    flights: {start:number;end:number;idle:number;frames:number[];longTasks:{ms:number}[];work:{method:string;id:string;ms:number}[]}[];
    commits:{at:number;name:string;hooks:number[]}[]; requests:{url:string;start:number;end:number}[];
  };
  const flights = raw.flights.filter(f=>f.end-f.start>1000).map((f,i)=>{
    const gaps=f.frames.filter(n=>n>0).sort((a,b)=>a-b);
    const percentile=(p:number)=>gaps[Math.min(gaps.length-1,Math.floor(gaps.length*p))];
    return {kind:i?'repeat':'first',durationMs:f.end-f.start,frames:gaps.length,medianMs:percentile(.5),p95Ms:percentile(.95),maxMs:gaps.at(-1),over32ms:gaps.filter(n=>n>32).length,longTasks:f.longTasks.length,longTaskMs:f.longTasks.reduce((n,e)=>n+e.ms,0),work:f.work,reactCommits:raw.commits.filter(c=>c.at>=f.start&&c.at<=f.end),requests:raw.requests.filter(r=>r.start>=f.start&&r.start<=f.end),postIdleMs:f.idle-f.end};
  });
  assert.ok(flights.length>=3, 'one first flight and two repeat flights must be measured');
  assert.ok(flights.every(f=>f.frames>10), 'refuse a probe that only sampled one frame');
  const sources = await page.evaluate("Object.entries(window.__wtpMap.getStyle().sources).map(([id,s])=>({id,type:s.type,hasUrl:!!s.url,hasTiles:!!s.tiles,loaded:window.__wtpMap.isSourceLoaded(id)}))");
  writeFileSync(output, JSON.stringify({label,base,runId:browser.runId,measuredAt:new Date().toISOString(),sources,flights,raw},null,2));
  console.log(JSON.stringify({output,flights:flights.map(({work,reactCommits,requests,...f})=>({...f,workCalls:work.length,reactCommits:reactCommits.length,requests:requests.length}))},null,2));
} finally { await browser.close(); }
