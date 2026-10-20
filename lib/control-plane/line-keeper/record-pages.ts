import type { Locator,Page } from 'playwright';
import type { RecordTarget } from './records.ts';
import type { PageProof } from './public.ts';
import { readerDestinations } from './destinations.ts';
import { stateDivisionId } from '../admin-view/v6-national-geography.ts';
import { bodyDisplayName } from '../../text/reader-names.ts';
import { PUBLIC_SITE_ORIGIN } from '../../ops/origins.ts';
import { formatDateLong } from '../../text/format-date.ts';
import { personIdentityKeys } from '../../officials/people-identity.ts';
import type { Officeholder } from '../../officials/types.ts';
import { readPublicPlace,observedDirectory } from './reader-page.ts';

export function recordApi(target:RecordTarget):string {
  const q=(s:string)=>encodeURIComponent(s),division=target.division||stateDivisionId(target.state.toLowerCase())||'';
  if(/ROLL_CALL|LEGISLATOR_VOTES|KEY_VOTE/.test(target.kind))return `/api/votes?member=${q(target.memberId)}&state=${q(target.state)}`;
  if(target.kind==='FEDERAL_CIVIC_RECORD')return `/api/federal-civic${target.memberId?`?member=${q(target.memberId)}`:''}`;
  if(target.kind==='FEDERAL_MONEY')return `/api/federal-money?division=${q(division)}&body=${q(target.bodyId)}`;
  if(/CAMPAIGN_FINANCE/.test(target.kind))return `/api/campaign-finance?division=${q(division)}`;
  if(target.kind==='MEETING_OUTCOME'||target.kind==='AGENDA_DOCUMENT')return `/api/agenda?meetingId=${q(target.id)}&bodyId=${q(target.bodyId)}`;
  if(/STATE_BILL/.test(target.kind))return `/api/bills?state=${q(target.state)}&member=${q(target.memberId)}`;
  if(/PROFILE|STATEMENT/.test(target.kind)&&target.memberId)return `/api/profile/${q(target.memberId)}?state=${q(target.state)}`;
  return `/api/public-records?division=${q(division)}`;
}
export function recordsWithIdentity(value:unknown,id:string):readonly Record<string,unknown>[] {
  if(!value||typeof value!=='object')return [];
  if(Array.isArray(value))return value.flatMap(v=>recordsWithIdentity(v,id));
  const row=value as Record<string,unknown>;
  const aliases=typeof row.id==='string'&&row.nativeIds&&typeof row.nativeIds==='object'&&Object.values(row.nativeIds).every(Array.isArray)
    ?personIdentityKeys(row as unknown as Pick<Officeholder,'id'|'personId'|'nativeIds'>):new Set<string>();
  return [row.id,row.rollId,row.meetingId,row.bodyId,row.personId,(row.roll as {id?:string}|undefined)?.id].includes(id)||aliases.has(id)?[row]:Object.values(row).flatMap(v=>recordsWithIdentity(v,id));
}
const apiValues=new WeakMap<Page,Map<string,unknown>>();
const ballotResponses=new WeakMap<Page,{url:string;html:string|null;status:number}>();
const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function carries(value:unknown,expected:RecordTarget['expected']):boolean {
  const held=new Set<string>();const collect=(v:unknown)=>{if(v&&typeof v==='object')for(const child of Object.values(v))collect(child);else held.add(JSON.stringify(v));};collect(value);
  return expected.every(v=>held.has(JSON.stringify(v)));
}
function visibleValue(text:string,value:string|number|boolean):boolean{
 const normalized=normalize(typeof value==='number'?value.toLocaleString('en-US'):String(value));
 if(typeof value==='number')return new RegExp(`(?:^| )${normalized}(?: |$)`,'u').test(text);
 return text.includes(normalized)||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&text.includes(normalize(formatDateLong(value)??value));
}
/** Follow the ordinary meeting-list control into the exact sitting's card. */
export async function openMeetingCard(page:Page,id:string):Promise<Locator>{
  await page.keyboard.press('Escape');
  const list=page.locator('button[data-stat="meetings"]');
  if(!await list.isVisible())await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await list.click();await page.getByRole('combobox',{name:'Group by',exact:true}).selectOption('none');
  const row=page.locator(`.al-overlay [data-meeting-row][data-meeting-id=${JSON.stringify(id)}]`);
  while(!await row.count()){
    const more=page.locator('.al-overlay button.al-more');if(!await more.count())throw Error('The exact meeting is missing from the public meeting list.');await more.click();
  }
  await row.getByRole('button').first().click();
  const card=page.locator(`[data-meeting-card=${JSON.stringify(id)}]`);await card.waitFor({state:'visible'});return card;
}
/** The same ordinary controls a resident uses. Only an exact identity and changed values
 * in an API response and visible DOM earn credit; an unsupported route remains fix work. */
export async function observeRecord(page:Page,target:RecordTarget,at:string,heldDestinations:Readonly<Record<string,string>>={}):Promise<PageProof> {
  const base={version:target.version,recordKey:target.recordKey,state:target.state,kind:target.kind,checkedAt:at,url:null as string|null};
  let api=false;
  try{
    page.setDefaultTimeout(3_000);
    if(['BALLOT_CANDIDACY','VOTING_SITE','CANDIDATE_PROFILE','CANDIDATE_PUBLICATION'].includes(target.kind)){
      const destinations=await readerDestinations(target.state),division=target.division||stateDivisionId(target.state)||'',zip=heldDestinations[division]??destinations.get(division);
      if(!zip)throw Error('This changed ballot record has no exact public place destination.');
      base.url=`${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`;
      let held=ballotResponses.get(page);if(held?.url!==base.url){const response=await page.goto(base.url,{waitUntil:'domcontentloaded',timeout:15_000});held={url:base.url,html:await response?.text()??null,status:response?.status()??0};ballotResponses.set(page,held);}
      api=held.status===200&&!!held.html?.includes(target.id);
      const record=page.locator(`[data-candidate-target=${JSON.stringify(target.id)}],[data-contest-id=${JSON.stringify(target.id)}]`).first();
      await record.waitFor({state:'visible',timeout:3_000});
      for(const section of await record.locator('summary').all())if(await section.locator('..').getAttribute('open')===null)await section.click();
      const text=normalize(await record.innerText());
      for(const v of target.displayValues??target.expected){
        if(typeof v==='string'&&/^https?:/.test(v)){if(!await record.locator(`a[href=${JSON.stringify(v)}]`).count())throw Error('A changed ballot link is missing from the exact visible record.');}
        else if(!visibleValue(text,v))throw Error('A changed ballot fact is missing from the exact visible record.');
      }
      if(!api)throw Error('The server reader response did not contain this exact ballot identity.');
      return {...base,api:true,live:true,reason:'Exact ballot identity and changed facts served by the production reader and observed in the visible ballot record.'};
    }
    if(!/DIRECTORY|LEGISLATOR|REGISTRY/.test(target.kind)){
      const path=recordApi(target),values=apiValues.get(page)??new Map<string,unknown>();apiValues.set(page,values);
      if(!values.has(path)){values.set(path,null);const response=await page.request.get(`${PUBLIC_SITE_ORIGIN}${path}`,{timeout:15_000});if(response.status()===200)values.set(path,await response.json());}
      api=recordsWithIdentity(values.get(path),target.id).some(row=>carries(row,target.expected));
    }
    const destinations=await readerDestinations(target.state),division=target.division||stateDivisionId(target.state.toLowerCase())||'',zip=heldDestinations[division]??destinations.get(division);
    if(!zip)throw Error('This changed record has no exact public place destination.');
    base.url=`${PUBLIC_SITE_ORIGIN}/?zip=${zip}`;
    const value=await readPublicPlace(page,zip);
    await page.keyboard.press('Escape');
    const tour=page.getByRole('button',{name:'Skip the tour',exact:true});if(await tour.isVisible())await tour.click();
    let modal:Locator;
    if(target.kind==='AGENDA_DOCUMENT'||target.kind==='MEETING_OUTCOME'){
      modal=await openMeetingCard(page,target.id);
    }else if(target.memberId){
      const member=recordsWithIdentity(value.coverage,target.memberId)[0];
      if(!member||typeof member.name!=='string')throw Error('The exact person is missing from this place’s reader API.');
      const door=page.getByRole('button',{name:'Open the officials here list',exact:true});
      if(!await door.isVisible())await page.getByRole('button',{name:'Open menu',exact:true}).click();
      await door.click();const button=page.locator('.door-panel').getByRole('button',{name:`${member.name} →`,exact:true});
      if(await button.count()!==1)throw Error('The exact person’s public control is ambiguous or missing.');await button.click();
      modal=page.getByRole('dialog').last();
      if(/DIRECTORY|LEGISLATOR|REGISTRY/.test(target.kind)){
        api=recordsWithIdentity(value,target.id).some(row=>carries(row,target.expected));
        if(!api)api=recordsWithIdentity(await observedDirectory(page,target.memberId),target.id).some(row=>carries(row,target.expected));
      }
    }else if(target.bodyId){
      const body=value.coverage?.bodies?.find((b:{bodyId:string})=>b.bodyId===target.bodyId);if(!body)throw Error('The exact body is missing from this place’s reader API.');
      const label=bodyDisplayName(body),door=page.getByRole('button',{name:'Open the bodies here list',exact:true});
      if(!await door.isVisible())await page.getByRole('button',{name:'Open menu',exact:true}).click();await door.click();
      await page.locator('.door-panel').locator(`button[title=${JSON.stringify(`More about ${label}`)}]`).click();modal=page.getByRole('dialog').last();
      if(target.kind==='REGISTRY_RUNTIME_BINDING')api=carries(body,target.expected);
    }else throw Error('The changed record has no connected person or body control on this public surface.');
    for(const section of await modal.locator('button.card-section-header').all())if(await section.getAttribute('aria-expanded')!=='true')await section.click();
    for(const button of await modal.getByRole('button',{name:/^(?:Show all|Show more|See all|Load more)/i}).all())if(await button.isVisible())await button.click();
    const identities=['data-recent-vote-id','data-picked-vote-id','data-key-vote','data-official-action-id','data-federal-record','data-campaign-record','data-bill-id','data-open-data-record','data-meeting-id','data-official-filing'];
    const record=modal.locator(identities.map(a=>`[${a}=${JSON.stringify(target.id)}]`).join(',')).first();
    const area=/DIRECTORY|LEGISLATOR|REGISTRY/.test(target.kind)||target.kind==='AGENDA_DOCUMENT'||target.kind==='MEETING_OUTCOME'?modal:record;
    await area.waitFor({state:'visible',timeout:3_000});
    const text=normalize(await area.innerText());
    for(const v of target.displayValues??target.expected){
      if(typeof v==='string'&&(/^(?:https?:|\/api\/portraits\/)/.test(v))){
        const links=await modal.locator(`a[href=${JSON.stringify(v)}]`).count(),pictures=area.locator(`img[src=${JSON.stringify(v)}]`);
        if(!links&&(!await pictures.count()||!await pictures.first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)))throw Error('A changed source link or portrait is missing from the exact public record.');
      }
      else if(!visibleValue(text,v))throw Error('A changed fact value is missing from the exact visible record.');
    }
    if(!api)throw Error('The exact changed record and fact values were not confirmed in the public API.');
    return {...base,api:true,live:true,reason:'Exact accepted record, identity and changed fact values observed in its API and visible public control.'};
  }catch(error){return {...base,api,live:false,reason:error instanceof Error?error.message:'The public record check failed'};}
}
