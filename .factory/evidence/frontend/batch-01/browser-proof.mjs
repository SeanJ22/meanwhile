import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root='/workspace/meanwhile';
const require=createRequire(root+'/package.json');
const {build}=require('esbuild');
const postcss=require(require.resolve('postcss',{paths:[require.resolve('@tailwindcss/postcss')]}));
const tailwind=require('@tailwindcss/postcss');
const dir='/tmp/frontend-proof';mkdirSync(dir,{recursive:true});
const css=await postcss([tailwind()]).process(readFileSync(root+'/app/globals.css','utf8')+'\n'+readFileSync(root+'/app/reader.css','utf8'),{from:root+'/app/globals.css'});
writeFileSync(dir+'/style.css',css.css);
writeFileSync(dir+'/entry.tsx',`
import React from '${root}/node_modules/react/index.js';
import { createRoot } from '${root}/node_modules/react-dom/client.js';
import { Card } from '${root}/components/ui/card';
import { MapCanvas } from '${root}/components/map/map-canvas';
const source={what:'Meeting record',provenance:{sourceOrg:'Public office',sourceUrl:'https://example.gov/record',collectedAt:'2026-10-04T00:00:00Z',verifiedAt:null}};
createRoot(document.getElementById('root')!).render(<main style={{padding:'var(--space-4)',maxWidth:600,margin:'auto'}}>
<Card title="Public meeting" eyebrow="Meeting" sources={[source]} onClose={()=>{document.getElementById('closed')!.textContent='Closed'}}>
<p className="t-body">The meeting record and its sources belong to the same card.</p>
</Card>
<div id="closed" />
<nav aria-label="Reader navigation"><button onClick={()=>{document.getElementById('navigation-result')!.textContent='Meetings selected'}}>Meetings</button></nav>
<ul aria-label="Meeting list"><li>Public meeting</li></ul>
<div id="navigation-result" />
<div style={{position:'relative',height:250}}><MapCanvas venues={[]} camera={null} focus={null} selectedVenueKey={null} frameAllVenues={false} theme="dark" districtTypes={[]} selectedDistrict={null} onDrawnDistricts={()=>{}} onDistrictClick={()=>{}} onDistrictError={()=>{}} onSelectVenue={()=>{}} onTileError={()=>{}} allowAutoFrame={false} /></div>
{['display','title','heading','body','detail','caption'].map(r=><p key={r} data-rung={r} className={'t-'+r}>{r}</p>)}
</main>);
`);
await build({entryPoints:[dir+'/entry.tsx'],bundle:true,outfile:dir+'/bundle.js',platform:'browser',nodePaths:[root+'/node_modules'],format:'iife',jsx:'automatic',tsconfig:root+'/tsconfig.json',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
writeFileSync(dir+'/index.html','<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
const {createServer}=await import('node:http');
const server=createServer((req,res)=>{
 const file=req.url==='/maplibre-gl-worker.mjs'?root+'/public/maplibre-gl-worker.mjs':dir+(req.url==='/'?'/index.html':req.url);
 try {res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(3187,'127.0.0.1',resolve));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage();
const result=[];
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(() => {
 const original=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(kind,...args) {
  if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl') return null;
  return original.call(this,kind,...args);
 };
});
for(const width of [390,1280]) {
 await page.setViewportSize({width,height:900});
 for(const theme of ['dark','light']) {
  const started=Date.now();
  await page.goto('http://127.0.0.1:3187');
  await page.getByRole('status').filter({hasText:'The map can’t show on this device'}).waitFor({timeout:5000}).catch(async error=>{console.log('PAGE ERRORS',errors);console.log('BODY',await page.locator('body').innerText());await page.screenshot({path:dir+'/webgl-failed.png'});throw error;});
  const mapFallbackMs=Date.now()-started;
  await page.getByRole('button',{name:'Meetings',exact:true}).click();
  if(await page.locator('#navigation-result').textContent()!=='Meetings selected')throw new Error('Navigation unusable');
  await page.getByRole('list',{name:'Meeting list'}).waitFor();
  await page.locator('.reader-card').waitFor();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const rungs=await page.locator('[data-rung]').evaluateAll(nodes=>nodes.map(node=>({rung:node.dataset.rung,size:getComputedStyle(node).fontSize,lineHeight:getComputedStyle(node).lineHeight})));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow) throw new Error('Horizontal overflow');
  const expected=['24px','18px','15px','14px','12px','11px'];
  if(rungs.some((r,i)=>r.size!==expected[i])) throw new Error(JSON.stringify(rungs));
  await page.getByRole('button',{name:'Sources'}).click();
  await page.getByRole('link',{name:'example.gov'}).waitFor();
  await page.screenshot({path:dir+'/card-'+width+'-'+theme+'.png',fullPage:true});
  await page.getByRole('button',{name:'Close Public meeting'}).click();
  if(await page.locator('#closed').textContent()!=='Closed')throw new Error('Close action failed');
  if(errors.length)throw new Error(errors.join('\n'));
  result.push({width,theme,rungs,overflow,mapFallbackMs,WebGLDisabledNavigationAndList:'pass',sourcesDisclosure:'pass',closeAction:'pass'});
 }
}
writeFileSync(dir+'/result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
await browser.close();server.close();
