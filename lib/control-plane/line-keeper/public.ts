import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { keeperState as stateCodeOf } from "./state.ts";
import { stateDivisionId } from '../admin-view/v6-national-geography.ts';
import { readerDestinations } from "./destinations.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";
import { launchGuarded } from "../../../scripts/browser.mts";
import { bodyDisplayName } from "../../text/reader-names.ts";
import { makeSnapshotSource } from "../../sources/snapshot/index.ts";
import { readReaderMeetingSettings } from "../../meetings/reader-settings.ts";
import type { Meeting } from "../../sources/types.ts";
import { formatMeetingDate,formatMeetingTime } from "../../map/format.ts";
import type { Page, Locator } from "playwright";
import type { LinkCount } from "./links.ts";
import type { RecordTarget } from './records.ts';
import { observeRecord,recordsWithIdentity,openMeetingCard } from './record-pages.ts';
import { readPublicPlace } from './reader-page.ts';

export interface MeetingTarget {
  readonly version:string; readonly recordKey:string; readonly state:string; readonly bodyId:string; readonly division:string;
  readonly meetingId:string; readonly title:string; readonly status:string|null; readonly startsAt:string|null; readonly agendaUrl:string|null;
  readonly collectedAt?:string;readonly publishedAt?:string;
}
export interface PageProof { readonly version:string; readonly recordKey:string; readonly state:string; readonly kind:string; readonly api:boolean; readonly live:boolean; readonly checkedAt:string; readonly reason:string; readonly url:string|null;readonly eligible?:boolean }
export interface FactTarget {readonly id:number;readonly entityId:string;readonly field:string;readonly value:unknown;readonly bodyId:string|null;readonly kind:string;readonly state:string;readonly family:string}
export const MEETING_TARGET_SQL=`SELECT c.id AS version,p.promoted_at AS published_at,c.retrieved_at AS collected_at,d->>'key' AS record_key,
 a->>'id' AS meeting_id,a->>'bodyId' AS body_id,a->>'ocdId' AS division,a->>'title' AS title,
 a->>'status' AS status,a->>'startsAt' AS starts_at,a->>'agendaUrl' AS agenda_url,c.scope
 FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
 LATERAL (SELECT reader_payload_node(c.candidate->'changeSet') AS changes) cs,
 LATERAL jsonb_array_elements(coalesce(changes->'added','[]'::jsonb)||coalesce(changes->'changed','[]'::jsonb)) d,
 LATERAL (SELECT reader_payload_node(d->'after') a) fields
 WHERE c.record_class='MEETING' AND c.state='PROMOTED' AND d->>'key' LIKE 'meeting:%'
 AND p.promoted_at >= $1::timestamptz AND p.promoted_at <= greatest($2::timestamptz,statement_timestamp()) ORDER BY c.retrieved_at,c.id`;
export async function readMeetingTargets(reader:Sql,from:string,through:string):Promise<readonly MeetingTarget[]> {
  const rows=await boundedQuery(reader,{operation:"line-keeper.meeting-targets",callClass:"PAGE"},MEETING_TARGET_SQL,[from,through]) as Record<string,unknown>[];
  return rows.map(r=>({version:String(r.version),recordKey:String(r.record_key),state:stateCodeOf(String(r.scope),String(r.body_id))?.toUpperCase()??'US',
    bodyId:String(r.body_id??''),division:String(r.division??String(r.body_id??'').split('#')[0]),meetingId:String(r.meeting_id??String(r.record_key).slice(8)),
    title:String(r.title??''),status:r.status as string|null,startsAt:r.starts_at as string|null,agendaUrl:r.agenda_url as string|null,collectedAt:new Date(String(r.collected_at)).toISOString(),publishedAt:new Date(String(r.published_at)).toISOString()}));
}

function strings(value:unknown):string[] {
  if(typeof value==='string')return value.trim()?[value]:[];
  if(typeof value==='number')return [String(value)];
  if(!value||typeof value!=='object')return [];
  return Object.entries(value).flatMap(([key,v])=>/^(id|personId|sourceId|bodyId|entityId|provenance|verifiedAt|collectedAt)$/.test(key)?[]:strings(v));
}
const cards=new WeakMap<Page,{bodyId:string;modal:Locator}>();
export function readerMeetingStatus(target:Pick<MeetingTarget,'status'|'startsAt'>,at:string):string|null {
  if(!target.startsAt||!target.status)return target.status;
  return makeSnapshotSource({load:()=>null}).normalize([{status:target.status,startsAt:target.startsAt} as Meeting],new Date(at))[0].status;
}
async function observeMeeting(page:Page,target:MeetingTarget,zip:string,at:string,fact?:FactTarget):Promise<PageProof> {
  let api=false;
  const base={version:target.version,recordKey:target.recordKey,state:target.state,kind:'Meetings',checkedAt:at,url:`${PUBLIC_SITE_ORIGIN}/?zip=${zip}`};
  try {
    page.setDefaultTimeout(3_000);
    const value=await readPublicPlace(page,zip);
    if((!fact||fact.kind==='meeting')&&value.placeStatus!==200)throw Error(value.placeError);
    const meeting=value.meetings.find(m=>m.id===target.meetingId||(m.mergedMeetingIds as string[]|undefined)?.includes(target.meetingId));
    const status=readerMeetingStatus(target,at);
    api=!!meeting && (!status||meeting.status===status)&&(!target.title||meeting.title===target.title)&&(!target.startsAt||Date.parse(String(meeting.startsAt))===Date.parse(target.startsAt))&&(fact!==undefined||meeting.agendaUrl===target.agendaUrl);
    if(!fact){
      const card=await openMeetingCard(page,String(meeting?.id??target.meetingId));cards.delete(page);
      const text=(await card.innerText()).toLowerCase();
      if(target.startsAt&&meeting&&(!text.includes(formatMeetingDate(meeting as unknown as Meeting).toLowerCase())||meeting.startPrecision!=='DAY'&&!text.includes(formatMeetingTime(meeting as unknown as Meeting).toLowerCase())))throw Error('The changed meeting date or time is not visible');
      if(status==='CONCLUDED'&&!text.includes('concluded')||status==='CANCELED'&&!/cancel/.test(text))throw Error('The changed meeting status is not visible');
      if(target.agendaUrl&&!await card.locator(`a[href=${JSON.stringify(target.agendaUrl)}]`).count())throw Error('The changed agenda link is not visible');
      if(!api)throw Error('The exact changed values were not confirmed in the reader API');
      return {...base,api:true,live:true,reason:'Exact changed meeting and values observed in the reader API and its visible meeting card.'};
    }
    const body=value.coverage?.bodies?.find(b=>b.bodyId===target.bodyId);
    if(!body) throw Error('The reader API did not include this body');
    let modal=cards.get(page)?.bodyId===target.bodyId?cards.get(page)!.modal:undefined;
    if(!modal){
    if(cards.has(page))await page.keyboard.press('Escape');
    const tour=page.getByRole('button',{name:'Skip the tour',exact:true});
    if(await tour.isVisible())await tour.click();
    const list=page.getByRole('button',{name:'Open the bodies here list',exact:true});
    if(!await list.isVisible())await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await list.click();
    const label=bodyDisplayName({...body,name:body.name??null,divisionType:body.divisionType??null});
    await page.locator('.door-panel').locator(`button[title=${JSON.stringify(`More about ${label}`)}]`).click();
    modal=page.getByRole('dialog').last();cards.set(page,{bodyId:target.bodyId,modal});
    }
    if(fact){
      const expected=strings(fact.value);
      if(!expected.length)throw Error('The changed field has no supported visible value');
      // Scope identity before comparing values. Another body's matching name earns no credit.
      const memberId=fact.kind==='person'?fact.entityId:fact.field.startsWith('member:')?fact.field.slice(7):null;
      const apiBody=JSON.stringify(value.coverage?.bodies?.find(b=>b.bodyId===fact.bodyId)??null);
      const apiValue=memberId?JSON.stringify(recordsWithIdentity(value,memberId)):fact.kind==='meeting'?JSON.stringify(meeting??null):apiBody;
      api=expected.every(v=>apiValue.includes(JSON.stringify(v)));
      for(const button of await modal.locator('button.card-section-header').all())if(await button.getAttribute('aria-expanded')!=='true')await button.click();
      let area=memberId?modal.locator(`[data-roster-holder=${JSON.stringify(memberId)}]`):modal;
      if(fact.kind==='person'){
        await area.getByRole('button').first().click();cards.delete(page);area=page.getByRole('dialog').last();
        for(const button of await area.locator('button.card-section-header').all())if(await button.getAttribute('aria-expanded')!=='true')await button.click();
      }
      const normalize=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const text=normalize(await area.innerText());
      for(const v of expected){
        if(/^https?:/.test(v)){if(await area.locator(`a[href=${JSON.stringify(v)}]`).count()===0)throw Error('The changed link is not visible');}
        else if(!text.includes(normalize(v)))throw Error('The changed fact is not visible');
      }
      if(fact.kind==='person')await page.keyboard.press('Escape');
      if(!api)throw Error('The exact changed fact was not confirmed in the reader API');
      return {...base,kind:fact.family,api:true,live:true,reason:'Exact changed fact observed in its reader API and visible body card.'};
    }
    throw Error('The changed fact has no public observation route');
  }catch(error){return {...base,api,live:false,reason:error instanceof Error?error.message:'The live page check failed'};}
}
/** An isolated, guarded browser. It cannot submit Ask, change data, or spend map quota. */
export async function checkMeetingPages(targets:readonly MeetingTarget[],at:string,facts:readonly FactTarget[]=[],records:readonly RecordTarget[]=[],destinations:Readonly<Record<string,string>>={}):Promise<readonly PageProof[]> {
  if(!targets.length&&!facts.length&&!records.length)return [];
  let browser:Awaited<ReturnType<typeof launchGuarded>>|undefined;
  const deadline=Date.now()+10*60_000;
  const settings=await readReaderMeetingSettings();
  const visibleTargets=targets.filter(t=>!t.startsAt||Date.parse(t.startsAt)>=Date.parse(at)-settings.shownBackDays*86_400_000&&Date.parse(t.startsAt)<=Date.parse(at)+settings.shownAheadDays*86_400_000);
  try {
    let args:string[]=[];
    if(process.env.AWS_LAMBDA_FUNCTION_NAME){
      const {default:chromium}=await import('@sparticuz/chromium');
      process.env.WTP_CHROMIUM_EXECUTABLE=await chromium.executablePath();args=[...chromium.args];
    }
    const proxy=process.env.HTTPS_PROXY;
    browser=await launchGuarded({label:'line-keeper',headless:true,blockWrites:true,args,...(proxy?{proxy:{server:proxy}}:{})});
    const proofs:PageProof[]=targets.filter(t=>!visibleTargets.includes(t)).map(t=>({version:t.version,recordKey:t.recordKey,state:t.state,kind:'Meetings',api:false,live:false,checkedAt:at,url:null,eligible:false,reason:'Outside the public meeting window; retained history is not a missing live pin.'}));
    const checks=[...visibleTargets.map(target=>({target,fact:undefined as FactTarget|undefined})),...facts.map(fact=>({fact,target:{version:`fact:${fact.id}`,recordKey:`fact:${fact.id}`,state:fact.state,
      bodyId:fact.bodyId??'',division:(fact.bodyId??'').split('#')[0],meetingId:fact.kind==='meeting'?fact.entityId.slice(8):'',title:'',status:null,startsAt:null,agendaUrl:null} as MeetingTarget}))];
    const groups=new Map<string,{zip:string;checks:typeof checks}>();
    for(const check of checks){
      const {target,fact}=check;
      const zips=await readerDestinations(target.state),zip=destinations[target.division]??zips.get(target.division);
      if(!zip){proofs.push({version:target.version,recordKey:target.recordKey,state:target.state,kind:fact?.family??'Meetings',api:false,live:false,checkedAt:at,url:null,reason:'No exact public ZIP destination is recorded for this body.'});continue;}
      const held=groups.get(zip)??{zip,checks:[]};held.checks.push(check);groups.set(zip,held);
    }
    const tasks:(()=>Promise<void>)[]=[];
    const guard=async(page:Page)=>{await page.context().route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.fallback():route.abort());};
    const meetingTasks:(()=>Promise<void>)[]=[];
    for(const {zip,checks:group} of groups.values())meetingTasks.push(async()=>{
      const page=await browser!.page();await guard(page);
      try {for(const {target,fact} of group.sort((a,b)=>a.target.bodyId.localeCompare(b.target.bodyId))){
        proofs.push(Date.now()>deadline?{version:target.version,recordKey:target.recordKey,state:target.state,kind:fact?.family??'Meetings',api:false,live:false,checkedAt:at,url:null,reason:'The hourly page check reached its time budget before this record could be observed.'}:await observeMeeting(page,target,zip,at,fact));
      }}finally{await page.context().close();}
    });
    // Interleave families and states. No large meeting or money family can consume every observation slot.
    const families=new Map<string,RecordTarget[]>();for(const r of records){const rows=families.get(`${r.state}:${r.kind}`)??[];rows.push(r);families.set(`${r.state}:${r.kind}`,rows);}
    const ordered:RecordTarget[]=[];while([...families.values()].some(rows=>rows.length))for(const rows of families.values()){const r=rows.shift();if(r)ordered.push(r);}
    const publicGroups=new Map<string,{targets:RecordTarget[]}>();
    for(const target of ordered){const zip=destinations[target.division]??(await readerDestinations(target.state)).get(target.division||stateDivisionId(target.state)||''),surface=['BALLOT_CANDIDACY','VOTING_SITE','CANDIDATE_PROFILE','CANDIDATE_PUBLICATION'].includes(target.kind)?'ballot':'map';
      const key=`${surface}:${zip??target.state}`,group=publicGroups.get(key)??{targets:[]};group.targets.push(target);publicGroups.set(key,group);
    }
    const recordTasks:(()=>Promise<void>)[]=[];
    for(const group of publicGroups.values())recordTasks.push(async()=>{
      const page=await browser!.page();await guard(page);try{for(const target of group.targets){
        if(Date.now()>deadline){proofs.push({version:target.version,recordKey:target.recordKey,state:target.state,kind:target.kind,api:false,live:false,checkedAt:at,url:null,reason:'The hourly page check reached its time budget before this record could be observed.'});continue;}
        proofs.push(await observeRecord(page,target,at,destinations));
      }}finally{await page.context().close();}
    });
    while(meetingTasks.length||recordTasks.length){const meeting=meetingTasks.shift(),record=recordTasks.shift();if(meeting)tasks.push(meeting);if(record)tasks.push(record);}
    // Browser work is isolated from runner slots. Two pages bound memory without serializing every state.
    await Promise.all(Array.from({length:2},async()=>{for(let task=tasks.shift();task;task=tasks.shift())await task();}));
    return proofs;
  }catch(error){return [...targets.map(t=>({version:t.version,recordKey:t.recordKey,state:t.state,kind:'Meetings'})),...facts.map(f=>({version:`fact:${f.id}`,recordKey:`fact:${f.id}`,state:f.state,kind:f.family})),...records.map(t=>({version:t.version,recordKey:t.recordKey,state:t.state,kind:t.kind}))].map(t=>({...t,api:false,live:false,checkedAt:at,url:null,reason:error instanceof Error?error.message:'The independent browser did not run'}));}
  finally{await browser?.close();}
}
export function pageLinks(proofs:readonly PageProof[]):readonly LinkCount[] {
  const grouped=new Map<string,PageProof[]>();
  for(const p of proofs.filter(p=>p.eligible!==false)){const key=`${p.state}:${p.kind}`;grouped.set(key,[...grouped.get(key)??[],p]);}
  return [...grouped.values()].flatMap(ps=>(['Reader API','Live page'] as const).map(link=>({state:ps[0].state,kind:ps[0].kind,link,incoming:ps.length,
    outgoing:ps.filter(p=>link==='Reader API'?p.api:p.live).length,unit:'eligible public path checks / exact records observed'})));
}
