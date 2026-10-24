/** Read-only source-to-page replay. The named environment variable must select an isolated production copy. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
import {cloneElement,isValidElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {installReaderDatabaseQuery} from '../lib/reader/database.ts';
import {routineTaskDue,routineTaskFromContract} from '../lib/civic-data/runner.ts';
import {requiredRoutineContract} from '../lib/civic-data/contracts.ts';
import {PostgresRoutineDataStore} from '../lib/civic-data/store.ts';
import {CENSUS_GEO_CONTRACT_ID} from '../lib/census-geography/publication.ts';

const arg=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const variable=arg('connection-env');
assert.ok(variable && /^BL01_[A-Z_]+$/.test(variable),'Name an explicit BL01 copy connection variable');
const connection=process.env[variable];assert.ok(connection);
assert.notEqual(new URL(connection).hostname.replace('-pooler',''),new URL(process.env.WTP_PRODUCTION_DATABASE_URL_WRITE??'postgres://unused@unused/db').hostname.replace('-pooler',''));
process.env.DATABASE_URL=connection;process.env.WTP_DB_ROLE='local';process.env.WTP_VITAL_SIGNS_REPORT='1';
const day=arg('day');
if(day){assert.match(day,/^2026-10-2[34]$/);const instant=Date.parse(`${day}T12:00:00Z`),RealDate=Date;
  globalThis.Date=new Proxy(RealDate,{construct(target,args){return Reflect.construct(target,args.length?args:[instant]);},get(target,key){return key==='now'?()=>instant:Reflect.get(target,key);}});}
const sql=neon(connection);let queries=0;
installReaderDatabaseQuery(async statements=>{queries+=statements.length;return await sql.transaction(statements.map(s=>sql.query(s.text,[...s.params])),{readOnly:true}) as never;});
const zip=arg('zip')??'94118';assert.match(zip,/^\d{5}$/);
const output=arg('out')??`.scratch/bl-01/page-${zip}-${day??'today'}`;
await mkdir(output,{recursive:true});
const {default:BallotPage}=await import('../app/ballot/page.tsx');
async function settle(node:unknown):Promise<unknown>{
  node=await node;
  if(Array.isArray(node))return Promise.all(node.map(settle));
  if(!node||typeof node!=='object')return node;
  if(isValidElement(node)){
    const element=node as ReactElement<Record<string,unknown>>;
    if(typeof element.type==='function'&&element.type.constructor.name==='AsyncFunction')return settle(await (element.type as (props:unknown)=>unknown)(element.props));
    const props=Object.fromEntries(await Promise.all(Object.entries(element.props).map(async([key,value])=>[key,await settle(value)])));
    return cloneElement(element,props);
  }
  if(Object.getPrototypeOf(node)===Object.prototype)return Object.fromEntries(await Promise.all(Object.entries(node).map(async([key,value])=>[key,await settle(value)])));
  return node;
}
const start=performance.now();
const tree=await settle(await BallotPage({searchParams:Promise.resolve({zip})}));
const html=renderToStaticMarkup(tree as Parameters<typeof renderToStaticMarkup>[0]);
const ms=performance.now()-start;
await writeFile(output+'/ballot.html',html);
const contests=[...html.matchAll(/data-contest-id="([^"]+)"/g)].map(match=>match[1]);
const retention=[...html.matchAll(/data-contest-type="RETENTION"/g)].length;
const cards=[...html.matchAll(/<article\b([^>]*data-contest-id="([^"]+)"[^>]*)>([\s\S]*?)<\/article>/g)].map(match=>({
  id:match[2],ocdId:/data-ocd-id="([^"]+)"/.exec(match[1])?.[1]??'',
  title:/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(match[3])?.[1].replace(/<[^>]+>/g,'')??'',
  text:match[3].replace(/<[^>]+>/g,' '),
}));
const house=cards.filter(card=>/\/cd:/.test(card.ocdId));
const senate=cards.filter(card=>/\/sldu:/.test(card.ocdId));
const stateHouse=cards.filter(card=>/\/sldl:/.test(card.ocdId));
if(['35801','33139','70112','63103','28202','58501','44111','37203','77005','84111','94118'].includes(zip))assert.ok(house.length,`${zip}: House race drawn`);
if(['35801','48226','57501'].includes(zip))assert.ok(senate.length,`${zip}: state Senate drawn`);
if(zip==='57501')assert.ok(stateHouse.length,'57501: state House drawn');
if(['44111','10025','30303','33139'].includes(zip))for(const card of cards.filter(card=>/governor|supreme court|public service commission/i.test(card.title)))assert.ok(!/\bLocal\b/.test(card.text),`${zip}: ${card.title} tier`);
const task=routineTaskFromContract(requiredRoutineContract(CENSUS_GEO_CONTRACT_ID));
const clock=await new PostgresRoutineDataStore().clock(task.sourceId,task.recordClass,task.scope,task.parserVersion);
const tomorrow=Date.parse('2026-10-24T12:00:00Z');
const report={zip,day:day??new Date().toISOString().slice(0,10),ms,queries,contests,retention,house,senate,stateHouse,cards:cards.map(({text:_text,...card})=>card),clock,geographyDueTomorrow:routineTaskDue(task,clock,tomorrow)};
await writeFile(output+'/result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({zip,day:report.day,ms,queries,contests:contests.length,retention,geographyDueTomorrow:report.geographyDueTomorrow}));
assert.ok(cards.length,'The actual page must draw published contests');
if(zip==='94118')assert.equal(retention,13,'Official CA certified list pp. 33–34: two Supreme Court and eleven First District appellate questions');
