import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root=process.cwd(), dir='/tmp/frontend-person-proof';
mkdirSync(dir,{recursive:true});
const resolver=createRequire(import.meta.url);
const {default:postcss}=await import(pathToFileURL(resolver.resolve('postcss',{paths:[resolver.resolve('@tailwindcss/postcss')]})).href);
const css=await postcss([tailwind()]).process(readFileSync(root+'/app/globals.css','utf8')+'\n'+readFileSync(root+'/app/reader.css','utf8'),{from:root+'/app/globals.css'});
writeFileSync(dir+'/style.css',css.css);
writeFileSync(dir+'/entry.tsx',`
import React, {useState} from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {PersonCard} from '${root}/components/ui/person-card';
import {CandidateBattlecard} from '${root}/components/ballot/candidate-battlecard';
import {CardSourcesContribution} from '${root}/components/ui/card-sources-contribution';
import {WorkingOnIt} from '${root}/components/demand/working-on-it';
import {CheckedLink} from '${root}/components/ui/checked-link';
import {groupByVenue} from '${root}/lib/meetings/venues';
import {createMarkerElement} from '${root}/lib/map/marker-pool';
import {StateFocusOverlay} from '${root}/components/map/state-focus-overlay';
const provenance=(url)=>({sourceOrg:'Public office',sourceUrl:url,collectedAt:'2026-10-05',verifiedAt:null});
const sweep={subjectId:'candidate:fixture',unreadable:0,equalEffort:true,topics:[{topic:'Housing',answer:'SEARCHED_NOTHING_MATCHED',passages:0,sourcesSearched:[{url:'https://search.example.gov/checked',kindLabel:'Campaign',basis:'THEIRS'}]}]};
function App(){
 const [identity,setIdentity]=useState('first');
 const source={what:'Office powers',provenance:provenance('https://office.example.gov/'+identity)};
 const online={id:'online',bodyId:'body:fixture',bodyName:'Council',jurisdiction:'Example',agendaUrl:null,ocdId:'ocd-division/country:us/state:az/place:example',title:'Public meeting',status:'SCHEDULED',startsAt:'2026-10-06T18:00:00Z',timeZone:'America/Phoenix',location:null,online:{label:'Online meeting',joinUrl:'https://join.example.gov/meeting'},provenance:provenance('https://calendar.example.gov/meeting')};
 const venue=groupByVenue([online],undefined,[{bodyId:'body:fixture',name:'Public office',address:'1 Public Plaza',lat:32,lng:-111,provenance:provenance('https://office.example.gov/address')}])[0];
 return <main style={{padding:'var(--space-4)',maxWidth:600,margin:'auto'}}>
  <div id="shared-person"><PersonCard title="Same name" identityKey={identity} identity={<p className="t-title">Same name</p>} subject={{type:'CANDIDATE',id:'candidate:'+identity}} contact={<a className="contact-pill" href="mailto:public@example.gov">Email</a>} sources={[source]} sections={{office:<><p>Published office powers.</p><CardSourcesContribution id="fetched-office" sources={[{what:'Fetched section evidence',provenance:provenance('https://fetched.example.gov/'+identity)}]}/></>,positions:<WorkingOnIt state={{kind:'searched',topic:'Housing',sweep,checkedAt:'2026-10-05'}}/>}} /></div>
  <button id="change-identity" onClick={()=>setIdentity('second')}>Change identity</button>
  <div id="incumbent"><CandidateBattlecard name="Fixture incumbent" subjectId="candidate:incumbent" incumbency="INCUMBENT" contact={<a className="contact-pill" href="mailto:incumbent@example.gov">Email</a>} sections={{office:<p>Same seat powers</p>}} /></div>
  <div id="challenger"><CandidateBattlecard name="Fixture challenger" subjectId="candidate:challenger" incumbency="CHALLENGER" contact={<a className="contact-pill" href="mailto:challenger@example.gov">Email</a>} sections={{}} /></div>
  <div id="states"><WorkingOnIt/><WorkingOnIt state={{kind:'not-published',item:'Agenda'}}/><WorkingOnIt state={{kind:'searched',topic:'Housing',sweep:{...sweep,equalEffort:false}}}/></div>
  <p id="dead-destination"><CheckedLink href="https://dead.example.gov/page#section">Held destination</CheckedLink></p>
  <div id="state-focus-proof" style={{position:'relative',width:300,height:220}}><StateFocusOverlay outline={{type:'Feature',properties:{statefp:'00',name:'Fixture',ocdId:'ocd-division/country:us/state:fixture'},geometry:{type:'Polygon',coordinates:[[[50,50],[200,50],[200,150],[50,150],[50,50]]]}}} project={([x,y])=>({x,y})} subscribe={null} theme={window.proofTheme}/></div>
  <div id="online-pin" ref={node=>{if(node&&!node.firstChild)node.append(createMarkerElement(venue))}}/>
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
`);
await build({entryPoints:[dir+'/entry.tsx'],bundle:true,outfile:dir+'/bundle.js',platform:'browser',nodePaths:[root+'/node_modules'],format:'iife',jsx:'automatic',tsconfig:root+'/tsconfig.json',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'}});
writeFileSync(dir+'/index.html','<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
let revision=1, copied=false, foundDead=false, settingsReads=0;
const server=createServer((req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/api/reader/settings'){settingsReads++;res.end(JSON.stringify({available:true,revision,values:copied?{'copy.working':'Gathering this information'}:{}}));return;}
 if(req.url==='/api/reader/link-health'){res.end(JSON.stringify({formatVersion:1,sweptAt:foundDead?'2026-10-05T13:00:00Z':'2026-10-05T12:00:00Z',deadAddresses:foundDead?['https://dead.example.gov/page']:[]}));return;}
 if(req.url==='/proof/copy'){copied=true;revision++;res.end('{}');return;}
 if(req.url==='/proof/dead'){foundDead=true;res.end('{}');return;}
 if(req.url?.startsWith('/api/official-actions/')){res.end(JSON.stringify({subjectId:decodeURIComponent(req.url.split('/').at(-1)),count:0,status:'HELD',records:[]}));return;}
 if(req.url?.startsWith('/api/')){res.statusCode=404;res.end('{}');return;}
 try {const file=dir+(req.url==='/'?'/index.html':req.url);res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(3188,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const results=[], errors=[];
try {
 for(const width of [390,1280])for(const theme of ['dark','light']){
  copied=false;foundDead=false;revision++;
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.addInitScript(theme=>{window.proofTheme=theme;},theme);
  page.on('pageerror',error=>{errors.push(error.message);console.error('pageerror:',error.message);});
  const before=settingsReads;
  await page.goto('http://127.0.0.1:3188');
  const person=page.locator('#shared-person');
  await person.locator('.reader-card').waitFor();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  assert.equal(await person.locator('[data-person-contact]').count(),1);
  const button=title=>person.getByRole('button',{name:new RegExp('^'+title)});
  await button('What this office does').click();
  await person.getByText('Published office powers.',{exact:true}).waitFor();
  assert.equal(await person.getByText('Public office',{exact:true}).filter({visible:true}).count(),0);
  await button('Sources').click();
  await person.getByRole('link',{name:'fetched.example.gov'}).waitFor();
  await button('Positions').click();
  await person.getByText('Not found in the sources checked.',{exact:true}).waitFor();
  assert.equal(await person.getByRole('link',{name:'search.example.gov'}).isVisible(),false);
  await button('Sources').click();
  await person.getByRole('link',{name:'search.example.gov'}).waitFor();
  await person.getByRole('link',{name:'fetched.example.gov'}).waitFor();
  await page.screenshot({path:dir+'/sources-'+width+'-'+theme+'.png',fullPage:true});
  await page.locator('#change-identity').click();
  await button('Sources').click();
  assert.equal(await person.locator('a[href="https://fetched.example.gov/first"]').count(),0);
  await person.locator('a[href="https://office.example.gov/second"]').waitFor();
  const headers=[];
  for(const candidate of ['incumbent','challenger']){
   const host=page.locator('#'+candidate);
   await host.getByRole('button',{name:'View Battlecard'}).click();
   const card=host.locator('.reader-card');
   await card.waitFor();
   const canonical=['What this office does','Positions','Committees','Offices near you','Campaign money','Voting record','Sources'];
   const names=await card.locator('.card-section-title').allTextContents();
   assert.deepEqual(names.filter(name=>canonical.includes(name)),canonical);
   headers.push(names.filter(name=>canonical.includes(name)));
   const contactIndex=await card.locator('[data-person-contact]').evaluate(node=>[...node.parentElement.children].indexOf(node));
   assert.equal(contactIndex,1);
   assert.equal(await card.getByRole('link',{name:'Email',exact:true}).count(),1);
   await page.screenshot({path:dir+'/'+candidate+'-'+width+'-'+theme+'.png',fullPage:true});
   await host.getByRole('button',{name:/^Close Fixture/}).click();
  }
  assert.deepEqual(headers[0],headers[1]);
  await page.locator('#state-focus-proof svg').waitFor();
  const fills=await page.locator('#state-focus-proof svg [fill]').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).fill));
  assert.deepEqual(fills,['rgb(255, 255, 255)','rgb(0, 0, 0)',theme==='light'?'rgb(255, 255, 255)':'rgb(11, 13, 18)','rgb(255, 255, 255)','rgb(0, 0, 0)']);
  const pin=page.locator('#online-pin button');
  assert.equal(await pin.getAttribute('data-venue-kind'),'ONLINE_ONLY');
  assert.match(await pin.getAttribute('aria-label'),/Online only/);
  assert.equal(await pin.evaluate(node=>node.style.getPropertyValue('--pin-color')),'var(--online)');
  assert.deepEqual(JSON.parse(await pin.getAttribute('data-join-urls')),['https://join.example.gov/meeting']);
  assert.equal(await page.locator('#states [data-working-on-it="not-published"]').innerText(),'Agenda not posted yet.');
  const deduplicatedReads=settingsReads-before;
  assert.ok(deduplicatedReads<=3,'copy subscriptions issued redundant initial reads: '+deduplicatedReads);
  await page.request.get('http://127.0.0.1:3188/proof/copy');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#states').getByText('Gathering this information.',{exact:true}).first().waitFor();
  await page.locator('#dead-destination a').waitFor();
  await page.request.get('http://127.0.0.1:3188/proof/dead');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#dead-destination [data-dead-link]').waitFor();
  assert.equal(await page.locator('#dead-destination a').count(),0);
  assert.match(await page.locator('#dead-destination').innerText(),/Held destination.*Gathering this information/s);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  results.push({width,theme,personHeaders:headers[0],contactPosition:1,sourcesOnly:'pass',closedSectionSourceRetention:'pass',identityReset:'pass',equalEffortOnly:'pass',settingsRefreshWithoutReload:'pass',deadLinkPlainText:'pass',onlinePinAndJoinLink:'pass',extrusionPaletteUnchanged:'pass',deduplicatedReads,horizontalOverflow:false});
  await page.close();
 }
 writeFileSync(dir+'/result.json',JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({fixture:'synthetic inputs, actual client components; no live/production acceptance claim',browser:'system Chromium substitute',results}));
} finally {await browser.close();server.close();}
