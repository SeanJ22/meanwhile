/** Built-browser production-data check. All writes/beacons from the app are blocked.
 * Start a production build with the verified read-only DATABASE_URL and WTP_VITAL_SIGNS_REPORT=1.
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/rs01-playwright NODE_USE_ENV_PROXY=1 RS01_ZIP=85701 
 *   node scripts/rs-01-browser-check.mjs
 * RS01_PORT defaults to3105. RS01_BROWSER_OUTPUT selects evidence directory.
 * Local Netlify-only settings and tile requests use their existing public production GETs.
 * No basemap key is supplied; the separate basemap background is unavailable in this environment.
 */
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const zip=process.env.RS01_ZIP;
if(!/^\d{5}$/.test(zip??''))throw new Error('RS01_ZIP must identify the ZIP being checked');
const output=process.env.RS01_BROWSER_OUTPUT??'.scratch/rs01/browser';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(); const errors=[],blocked=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
await context.route('**/*',async route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){blocked.push(req.url());return route.abort();}if(req.url().includes('/api/reader/settings')){const r=await fetch('https://meanwhileusa.com/api/reader/settings');return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});}if(req.url().includes('/api/boundaries/')){const r=await fetch('https://tiles.meanwhilemaps.com/us-2025.pmtiles',{headers:{Range:req.headers()['range']??'bytes=0-16383'}});return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});}return route.continue()});
await page.addInitScript(()=>{
 window.rs01={reads:[],renders:[]};
 const now=()=>performance.now();
 const paint=(kind)=>{if(window.rs01[kind+'PaintPending']||window.rs01[kind+'Paint'])return;window.rs01[kind+'PaintPending']=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.rs01[kind+'Paint']=now()}));};
 const observe=()=>{
  const read=key=>{const value=document.querySelector('[data-stat="'+key+'"] .num')?.textContent;return value&&/^\d+$/.test(value)?Number(value):null};
  const row={ms:now(),meetings:read('meetings'),bodies:read('bodies here'),officials:read('officials')};
  const previous=window.rs01.renders.at(-1);
  if(!previous||row.meetings!==previous.meetings||row.bodies!==previous.bodies||row.officials!==previous.officials)window.rs01.renders.push(row);
  if(row.officials>0&&window.rs01.state)paint('state');
  if(row.officials>0&&window.rs01.state&&window.rs01.place&&row.meetings===window.rs01.expectedMeetings&&row.bodies===window.rs01.expectedBodies)paint('place');
  if(!window.rs01.boundaryPaint&&Number(document.querySelector('[data-stat="districts in view"] .num')?.textContent)>0)window.rs01.boundaryPaint=now();
 };
 new MutationObserver(observe).observe(document,{childList:true,subtree:true,characterData:true});
 const original=Response.prototype.json;
 Response.prototype.json=async function(){const data=await original.call(this);const url=this.url;if(url.includes('/api/meetings?')||url.includes('/api/reader/state?')){const kind=url.includes('/api/meetings?')?'place':'state';if(!window.rs01[kind]){window.rs01[kind]=now();window.rs01.reads.push({url,kind,status:this.status,serverTiming:this.headers.get('server-timing'),ms:now()});if(kind==='place'){window.rs01.expectedMeetings=data.meetings.length;window.rs01.expectedBodies=data.coverage?.bodies.length;}observe();}}return data;};
});
await page.goto(`http://localhost:${process.env.RS01_PORT??3105}/?zip=${zip}`,{waitUntil:'commit'});
await page.waitForFunction(()=>window.rs01?.placePaint&&window.rs01?.statePaint,null,{timeout:20000});
const timing=await page.evaluate(()=>({...window.rs01,resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')||r.name.includes('/ballot')).map(r=>({name:r.name,start:r.startTime,duration:r.duration})),navigation:performance.getEntriesByType('navigation').map(n=>({responseEnd:n.responseEnd,domContentLoaded:n.domContentLoadedEventEnd})),body:document.body.innerText}));
await page.screenshot({path:`${output}/${zip}-built.png`,fullPage:true});
const dom=await page.evaluate(()=>({meetings:Number(document.querySelector('[data-stat=meetings] .num')?.textContent),bodies:Number(document.querySelector('[data-stat="bodies here"] .num')?.textContent),officials:Number(document.querySelector('[data-stat=officials] .num')?.textContent)}));if(dom.meetings!==timing.expectedMeetings||dom.bodies!==timing.expectedBodies||!(dom.officials>0))errors.push('Rendered holdings do not match the place package: '+JSON.stringify(dom));if(Math.max(timing.statePaint,timing.placePaint)>=3000)errors.push('Cold rendered information exceeded three seconds');
if(timing.resources.some(r=>new URL(r.name).pathname==='/ballot'&&r.start<timing.place))errors.push('Ballot prefetched before the requested place was parsed');
const result={zip,timing,dom,errors,blocked,buttons:await page.getByRole('button').allTextContents()};
console.log(JSON.stringify(result,null,2));await writeFile(`${output}/${zip}.json`,JSON.stringify(result,null,2));
await browser.close();
if(errors.length)process.exitCode=1;
