/** One state's built reader, with the exact production replay answers and read-only state data. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
import {launchGuarded} from './browser.mts';
import {encodeReaderValue,decodeReaderValue} from '../lib/reader/wire.ts';
import {readerBodyName} from '../lib/text/reader-names.ts';
import {installFactReader} from '../lib/facts/db.ts';
import {installReaderDatabaseQuery} from '../lib/reader/database.ts';
import type {CoveredBody} from '../lib/registry/coverage.ts';
const state=process.argv.find(a=>a.startsWith('--state='))?.slice(8);assert.match(state??'',/^[A-Z]{2}$/);
const origin=process.env.PB01_BROWSER_ORIGIN??'http://127.0.0.1:3105',directory=`.scratch/pb01/national/${state}`;
const report=JSON.parse(await readFile(directory+'/results.json','utf8')) as {first?:unknown;tomorrow?:unknown;answers:{phase:string;zip:string;legistar:{id:string;members:{name:string}[]}[]}[]};
assert.ok(report.first&&report.tomorrow,'Complete the state publication replay before rendering it');
const first=report.answers.filter(a=>a.phase==='first').sort((a,b)=>b.legistar.length-a.legistar.length);
const zips=state==='WI'?['53703','53202']:[first[0].zip];
const retained=new Set<string>();
if(state==='CA'){
 const before=JSON.parse(await readFile(directory+'/results-before-retirement-fix.json','utf8')) as {first:{missing:{source:string;body:string}[]}};
 for(const m of before.first.missing)if(m.source==='legistar-members:metro')retained.add(m.body);
 const place=first.find(a=>a.legistar.some(b=>retained.has(b.id)));if(place&&!zips.includes(place.zip))zips.push(place.zip);
}
if(state==='FL'){const keywest=first.find(a=>a.legistar.some(b=>b.members.some(m=>m.name==='Pope')));if(keywest&&!zips.includes(keywest.zip))zips.push(keywest.zip);}
process.env.DATABASE_URL=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;process.env.WTP_VITAL_SIGNS_REPORT='1';
const sql=neon(process.env.DATABASE_URL!);
const query=async(t:string,p:readonly unknown[]=[]) => (await sql.transaction([sql.query(t,[...p])],{readOnly:true}))[0] as Record<string,unknown>[];
installFactReader(query);installReaderDatabaseQuery(async ss=>Promise.all(ss.map(s=>query(s.text,s.params))));
const {readerStateResponse}=await import('../lib/reader/state-response.ts');
const settings=await readFile('.scratch/pb01/settings.json','utf8');
const browser=await launchGuarded({label:`pb-01-${state}-production-replay-page`,blockWrites:true});
const results=[];
try{for(const zip of zips){
 const stateResponse=await readerStateResponse(new Request('http://localhost/api/reader/state?zip='+zip));assert.equal(stateResponse.status,200);
 const stateText=await stateResponse.text();await writeFile(`${directory}/state-${zip}.json`,stateText);
 for(const phase of ['first','tomorrow']){
  const answer=decodeReaderValue(JSON.parse(await readFile(`${directory}/${phase}-${zip}.json`,'utf8'))) as Record<string,unknown>&{coverage:{bodies:CoveredBody[]};stateResponse?:unknown};
  const own=new Set(first.find(a=>a.zip===zip)!.legistar.map(b=>b.id));
  const bodies=answer.coverage.bodies.filter(b=>own.has(b.bodyId));assert.ok(bodies.every(b=>b.readerRoster!.members.length));
  const candidates=bodies.filter(b=>b.name&&b.readerRoster!.members.some(m=>m.id.startsWith('legistar:'))).sort((a,b)=>b.readerRoster!.members.length-a.readerRoster!.members.length);
  const target=candidates.find(b=>retained.has(b.bodyId))??candidates.find(b=>b.bodyId==='ocd-division/country:us/state:wi/county:dane#governing')??
   candidates.find(b=>b.readerRoster!.members.some(m=>m.name==='Pope'))??
   candidates.find(b=>answer.coverage.bodies.filter(other=>other.name&&readerBodyName(other.name)===readerBodyName(b.name!)).length===1)??candidates[0];
  answer.stateResponse={status:200,headers:[],value:JSON.parse(stateText)};const encoded=JSON.stringify(encodeReaderValue(answer));
  const context=await browser.context({viewport:{width:1440,height:1080}}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/api/**',async route=>{const path=new URL(route.request().url()).pathname;
   if(path==='/api/meetings')return route.fulfill({status:200,contentType:'application/json',body:encoded});
   if(path==='/api/reader/state')return route.fulfill({status:200,contentType:'application/json',body:stateText});
   if(path==='/api/reader/settings')return route.fulfill({status:200,contentType:'application/json',body:settings});
   return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Outside this membership replay"}'});
  });
  try{
   await page.goto(origin+'/?zip='+zip,{waitUntil:'domcontentloaded'});
   await page.getByText(String(answer.coverage.bodies.length),{exact:true}).first().waitFor({timeout:15000});
   await page.getByRole('button',{name:'Skip',exact:true}).click({timeout:15000});
   const keep=page.getByRole('button',{name:'Keep current view',exact:true});if(await keep.isVisible())await keep.click();
   await page.getByRole('button',{name:'Who governs here?',exact:true}).click();
   const disclosure=page.locator('[data-other-bodies-disclosure]');if(await disclosure.count())await disclosure.locator('summary').click();
   let members=0,links:string[]=[];
   if(target){
    await page.getByRole('button',{name:readerBodyName(target.name!),exact:true}).first().click();
    await page.getByText('Who sits on it',{exact:true}).click();
    await page.locator('[data-roster-holder]').first().waitFor({timeout:10000});members=await page.locator('[data-roster-holder]').count();assert.equal(members,target.readerRoster!.members.length);
    if(zip==='53703'){assert.equal(members,37);assert.equal(await page.getByRole('button',{name:'Henry Fries',exact:true}).count(),1);await page.getByRole('button',{name:'Henry Fries',exact:true}).scrollIntoViewIfNeeded();}
    if(target.readerRoster!.members.some(m=>m.name==='Pope'))assert.equal(await page.getByRole('button',{name:'Pope',exact:true}).count(),1);
    await page.getByText('Sources',{exact:true}).last().click();
    links=await page.locator('a[href*="webapi.legistar.com/v1/"]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href));assert.ok(links.some(url=>url.includes('/officerecords?')));
   }
   assert.deepEqual(errors,[]);await page.screenshot({path:`${directory}/page-${phase}-${zip}.png`,fullPage:true});
   const row={state,phase,zip,legistarBoards:bodies.length,emptyLegistarBoards:0,bodyId:target?.bodyId??null,bodyName:target?.name??null,members,links,pageErrors:errors};results.push(row);console.log(JSON.stringify(row));
  }catch(error){await page.screenshot({path:`${directory}/page-failure-${phase}-${zip}.png`,fullPage:true});await writeFile(`${directory}/page-failure-${phase}-${zip}.txt`,await page.locator('body').innerText());throw error;}
  finally{await context.close();}
 }
}}finally{await browser.close();}
await writeFile(directory+'/browser.json',JSON.stringify(results,null,2)+'\n');
