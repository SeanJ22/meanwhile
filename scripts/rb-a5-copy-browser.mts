import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {launchGuarded} from './browser.mts';
import {resolve} from 'node:path';
import {PUBLIC_SITE_ORIGIN} from '../lib/ops/origins.ts';
const directory=resolve(process.argv[2]??'.scratch/rb-a5');
const file=(name:string)=>resolve(directory,name);
const proof=JSON.parse(await readFile(file('connection-proof.json'),'utf8'));
const response=JSON.parse(await readFile(file('place-copy-response.json'),'utf8'));
const target=response.coverage.bodies.find((body:{bodyId:string})=>body.bodyId===proof.subjectId);
assert.ok(target?.name);assert.match(response.nearZip,/^\d{5}$/);
const targetName=new RegExp(String(target.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
const browser=await launchGuarded({label:'rb-a5-queue-place-copy',blockWrites:true,channel:'chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],proxy:{server:process.env.HTTPS_PROXY!}});
try{
 const results=[];
 for(const stage of ['before','copy']){
  const data=JSON.parse(await readFile(file(`place-${stage}-response.json`),'utf8'));
  const context=await browser.context({viewport:{width:1440,height:1100},serviceWorkers:'block'});
  let served=0;
  await context.route('**/api/reader/state?*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data.stateResponse.value)}));
  await context.route('**/api/meetings?*',r=>{served++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})});
  const page=await context.newPage();
  await page.goto(`${PUBLIC_SITE_ORIGIN}/?zip=${response.nearZip}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'Skip',exact:true}).click({timeout:5000}).catch(()=>{});
  await page.getByText('Keep current view',{exact:true}).click({timeout:1000}).catch(()=>{});
  await page.getByRole('button',{name:'Who governs here?',exact:true}).click({timeout:20000});
  await page.getByText('Governments at this place',{exact:true}).waitFor({timeout:20000});
  const targetButton=page.getByRole('button',{name:targetName});
  if(!await targetButton.isVisible())await page.getByText(/^See the rest/).click({timeout:20000});
  await targetButton.click({timeout:20000});
  const phone=page.getByText(proof.placePageReaderValue,{exact:false}).first();
  if(stage==='copy')await phone.waitFor({state:'visible',timeout:15000});else assert.equal(await phone.isVisible(),false);
  assert.ok(served>0);
  await page.screenshot({path:file(`place-${stage}.png`),fullPage:true});
  await writeFile(file(`place-${stage}.txt`),await page.locator('body').innerText());
  if(stage==='copy'){
   await page.getByRole('button',{name:/^Sources/}).last().click();
   const link=page.locator(`a[href="${proof.sourceUrl}"]`).last();await link.scrollIntoViewIfNeeded();assert.ok(await link.isVisible());
   await page.screenshot({path:file('place-copy-sources.png'),fullPage:true});
  }
  results.push({stage,url:page.url(),copiedResponsesServed:served,phoneVisible:stage==='copy'});
  await context.close();
 }
 await writeFile(file('place-browser-proof.json'),JSON.stringify({...proof,browserAt:new Date().toISOString(),contexts:results,writesBlocked:{count:browser.writesBlocked.count,paths:[...browser.writesBlocked.paths]}},null,2));
 console.log({contexts:results,writesBlocked:browser.writesBlocked});
}finally{await browser.close();}
