import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { launchGuarded } from './browser.mts';
import { signSession,ADMIN_SESSION_COOKIE } from '../lib/control-plane/admin-auth.ts';
import { ADMIN_ORIGIN } from '../lib/ops/origins.ts';
import { buildScoreboard } from '../lib/control-plane/admin-view/scoreboard-read.ts';
const dir=process.argv[2]??'.scratch/rb-a3',base=process.env.RB_A3_COPY_BASE??'http://localhost:3107';
if(!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw Error('The writable copy UI must be local');
const currentReader=process.argv.includes('--current-reader');
const readerBase=currentReader?'https://meanwhileusa.com':base;
const prefix=currentReader?'current-reader':'copy';
const browser=await launchGuarded({label:'rb-a3-copy-reader-and-admin',blockWrites:true,headless:true,args:['--no-sandbox'],proxy:{server:'http://proxy:8080',bypass:'localhost,127.0.0.1'}});
try {
 const context=await browser.context({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',async route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))await route.abort('blockedbyclient');else await route.fallback();});
 await context.route('**/api/reader/state?*',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(JSON.parse(readFileSync(`${dir}/mesa-copy-meetings.json`,'utf8')).stateResponse.value)}));
 await context.route('**/api/meetings?*',async route=>route.fulfill({status:200,contentType:'application/json',body:readFileSync(`${dir}/mesa-copy-meetings.json`,'utf8')}));
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(`${readerBase}/?zip=85201`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('button',{name:'Skip',exact:true}).click({timeout:20000}).catch(()=>{});
 await page.getByText('Keep current view',{exact:true}).click({timeout:1000}).catch(()=>{});
 await page.getByRole('button',{name:'Who governs here?',exact:true}).click({timeout:15000});
 await page.getByRole('button',{name:'City Council',exact:true}).click({timeout:15000});
 await page.getByText('20 E. Main Street',{exact:false}).first().waitFor({state:'visible',timeout:15000});
 await page.locator('button').filter({hasText:/27\s*Officials/}).waitFor({state:'visible',timeout:15000});
 await page.screenshot({path:`${dir}/${prefix}.png`,fullPage:true});
 const beforeSources=await page.locator('body').innerText();assert(beforeSources.includes('20 E. Main Street'));assert(beforeSources.includes('Mesa, AZ 85201'));
 await page.getByRole('button',{name:/^Sources/}).click();
 const apiUrl='https://webapi.legistar.com/v1/mesa/Bodies?$filter=BodyActiveFlag%20eq%201';
 const govUrl='https://www.mesaaz.gov/Government/Mayor-City-Council';
 if(!currentReader){
 assert(await page.locator('a').evaluateAll((links,urls)=>urls.every(url=>links.some(a=>a.getAttribute('href')===url)),[apiUrl,govUrl]));
 const apiLink=page.locator('a[href^="https://webapi.legistar.com/v1/mesa/Bodies"]').first();
 await apiLink.scrollIntoViewIfNeeded();
 assert(await apiLink.isVisible());
 }
 const govLink=page.locator('a[href="https://www.mesaaz.gov/Government/Mayor-City-Council"]').last();
 await govLink.scrollIntoViewIfNeeded();assert(await govLink.isVisible());
 await page.screenshot({path:`${dir}/${prefix}-sources.png`,fullPage:true});writeFileSync(`${dir}/${prefix}-body.txt`,await page.locator('body').innerText());
 console.log(JSON.stringify({reader:{url:page.url(),status:response?.status(),addressVisible:true,governmentSourceLinked:true,bothSourcesLinked:!currentReader,pageErrors:errors}}));
 if(!currentReader){
 const admin=await browser.context({viewport:{width:1440,height:1000},extraHTTPHeaders:{'x-forwarded-host':new URL(ADMIN_ORIGIN).host},serviceWorkers:'block'});
 const now=Math.floor(Date.now()/1000);const cookie=await signSession({sid:'adm_rba3localcopy00000000',iat:now,exp:now+3600,via:'google'},process.env.WTP_ADMIN_SESSION_KEY!);
 await admin.addCookies([{name:ADMIN_SESSION_COOKIE,value:cookie,url:base.replace('http:','https:'),secure:true,httpOnly:true,sameSite:'Lax'}]);
 const hours=JSON.parse(readFileSync(`${dir}/copy-admin-hours.json`,'utf8'));
 const data=buildScoreboard({observedAt:new Date().toISOString(),factStore:{blanks:[],hours},places:null,placesUnread:0,orders:null,publication:null,shutDoors:null,returning:null,
  learning:{trends:[],readings:[],notMeasured:[]},doors:null,gates:null,readiness:[]});
 await admin.route('**/*',async route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))await route.abort('blockedbyclient');else await route.fallback();});
 await admin.route('**/api/admin/v6/scoreboard?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({contract:'admin-v6/scoreboard@1',scope:'us',revision:'rb-a3-local-copy',asOf:new Date().toISOString(),data,missingParts:[]})}));
 const dashboard=await admin.newPage();await dashboard.goto(`${base}/admin?view=scoreboard`,{waitUntil:'domcontentloaded',timeout:120000});
 await dashboard.getByText('Facts published, by state and hour',{exact:true}).waitFor({state:'visible',timeout:30000});
 const az=dashboard.getByRole('row').filter({has:dashboard.getByRole('cell',{name:'Arizona',exact:true})});
 await az.waitFor({state:'visible',timeout:30000});assert.deepEqual(await az.getByRole('cell').allTextContents(),['Arizona','1','1']);
 await az.scrollIntoViewIfNeeded();await dashboard.screenshot({path:`${dir}/copy-admin.png`,fullPage:false});
 writeFileSync(`${dir}/copy-admin-body.txt`,await dashboard.locator('body').innerText());
 console.log(JSON.stringify({admin:{url:dashboard.url(),arizona:await az.innerText(),stateRows:await dashboard.getByRole('row').filter({has:dashboard.getByRole('cell')}).count()}}));
 }
}finally{await browser.close();}
