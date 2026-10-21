import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir='/tmp/ba01-northeast/nyc-borough-samples';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,proxy:{server:process.env.HTTPS_PROXY}});
const points=[['kings','209','Joralemon Street','11201'],['queens','90-27','Sutphin Boulevard','11435'],['bronx','1932','Arthur Avenue','10457'],['richmond','1','Edgewater Street','10305']];
for(const [county,hn,sn,zip] of points){
 const context=await browser.newContext();const captures=[];
 await context.route('**/*',async route=>{try{
  const response=await context.request.fetch(route.request());const url=response.url();
  if(response.ok() && /findmypollsite\.vote\.nyc\/api\/|electionstreet\.com\/api\//.test(url)){
   const body=await response.body();const retrievedAt=new Date().toISOString();const name=county+'-'+captures.length+'.json';
   await writeFile(dir+'/'+name,body);captures.push({name,url,retrievedAt,httpStatus:response.status(),rawHash:createHash('sha256').update(body).digest('hex')});
  }
  await route.fulfill({response});
 }catch{await route.abort();}});
 const page=await context.newPage();const url='https://findmypollsite.vote.nyc/?'+new URLSearchParams({hn,sn,zip});
 try{
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});try{await page.waitForLoadState('networkidle',{timeout:12000});}catch{}
  const text=await page.locator('body').innerText();await writeFile(dir+'/'+county+'.txt',text);await writeFile(dir+'/'+county+'.html',await page.content());await writeFile(dir+'/'+county+'-captures.json',JSON.stringify(captures,null,2));
  const ballotCapture=captures.find(r=>r.url.includes('/api/contestlist'));
  console.log(JSON.stringify({county,zip,captures:captures.length,ballot:!!ballotCapture,tail:text.slice(-120)}));
 }catch(error){console.log(county,String(error));}
 await context.close();
}
await browser.close();
