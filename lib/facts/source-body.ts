import type {ReaderCachePurger} from '../reader/cache.ts';
import {governmentSiteFromDirectory} from '../hunt/government-site.ts';
import {publishClaim} from './publish.ts';
import {readCheckEntity} from './entity-read.ts';
import {ensureEntity} from './entities.ts';
import {checkFact,hostOf} from './check.ts';
import {captureProvenance} from './capture.ts';
import {saveCaptureCopy} from './source-copy.ts';
import {subBodyId} from '../civic-data/meeting-body-crosswalk.ts';
import type {FactDb,Query,Clocks} from './publish.ts';
import type {WorkerPublicationCapture} from '../civic-data/worker-roster-publication.ts';

/** The type stated in the sourced name, rather than an invented board. */
export const bodyTypeWord=(name:string):string|null=>/\b(?:agency|council|commission|assembly|board|committee|selectboard|selectmen|trustees)\b/i.exec(name)?.[0]??null;

/** A newly sourced body needs a name and its source, just as an existing body
 * does. Its government's native identity and state remain the parent. */
export async function ensureSourceBody(input:{facts:FactDb&{query:Query};subjectId:string;name:string;quote:string;capture:WorkerPublicationCapture;clocks:Clocks;now:Date}){
 if(!bodyTypeWord(input.name))return null;
 const root=input.subjectId.split('#')[0]!,host=hostOf(input.capture.evidence.canonicalUrl);
 const governments=await input.facts.query(`SELECT g.id,g.name,g.state,g.parent_id FROM entity g WHERE g.kind='government'
   AND (g.id=$1 OR g.parent_id=$1 AND EXISTS(SELECT 1 FROM entity_host h WHERE h.entity_id=g.id AND ($2=h.host OR $2 LIKE '%.'||h.host)))
   ORDER BY g.id LIMIT 2`,[root,host]);
 if(governments.length!==1)return null;
 const government=governments[0],entity=await readCheckEntity(input.facts.query,String(government.id));
 if(!entity)return null;
 const copy=await input.facts.transaction(q=>saveCaptureCopy(q,input.capture));
 const checked=checkFact({entity,fieldKind:'officeholder',provenance:captureProvenance(input.capture,entity.hosts),valueText:input.name,quote:input.quote,copy},input.now,input.clocks.windowHours);
 if(!checked.ok)return null;
 const statedId=input.subjectId;
 const id=statedId.includes('#') && !statedId.includes('#inventory:') ? statedId.replace(/#calendar$/,'') : subBodyId(String(government.id),input.name);
 const existing=await input.facts.query('SELECT id,name,state,parent_id FROM entity WHERE id=$1',[id]);
 if(!existing.length)await ensureEntity(input.facts.query,{id,kind:'body',name:input.name,state:government.state as string|null,parentId:String(government.id)});
 // Preserve the government's held division relation, including registrations
 // whose parent is their place but which have no separate entity_place row.
 await input.facts.query(`INSERT INTO entity_place(entity_id,place_id)
   SELECT $1,place_id FROM entity_place WHERE entity_id=$2
   UNION SELECT $1,p.id FROM entity p WHERE p.id=$3 AND p.kind='place' ON CONFLICT DO NOTHING`,[id,government.id,government.parent_id]);
 return existing.length?{id:String(existing[0].id),name:String(existing[0].name),state:existing[0].state as string|null,parentId:existing[0].parent_id as string|null}:{id,name:input.name,state:government.state as string|null,parentId:String(government.id)};
}

/** A directory's printed government name and its linked website are checked
 * as a fact about that government, independently of any future body record. */
export async function publishGovernmentWebsite(input:{purge?:ReaderCachePurger;facts:FactDb&{query:Query};subjectId:string;value:string;quote:string;capture:WorkerPublicationCapture;clocks:Clocks;now:Date}){
 const [row]=await input.facts.query("SELECT id,name FROM entity WHERE id=$1 AND kind='government'",[input.subjectId]);
 if(!row)return {blank:'GOVERNMENT_NOT_HELD'} as const;
 const entity=await readCheckEntity(input.facts.query,String(row.id));if(!entity)return {blank:'GOVERNMENT_NOT_HELD'} as const;
 const site=governmentSiteFromDirectory(String(row.name),{url:input.capture.evidence.canonicalUrl,html:input.capture.evidence.text,artifactId:input.capture.evidence.artifactId,observedAt:input.capture.observedAt});
 if(!site || site.url!==input.value)return {blank:'GOVERNMENT_WEBSITE_LINK_NOT_ON_SOURCE'} as const;
 const copy=await input.facts.transaction(q=>saveCaptureCopy(q,input.capture));
 const provenance=captureProvenance(input.capture,entity.hosts);
 const outcome=await publishClaim(input.facts,{entity,field:'homepage',fieldKind:'contact',value:input.value,valueText:input.value,quote:input.value,copy,provenance,producedBy:'box',costUsd:0},input.clocks,input.now,{purge:input.purge});
 if(!('blank' in outcome) && provenance==='OFFICIAL')await input.facts.query('INSERT INTO entity_host(entity_id,host) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.id,hostOf(input.value)]);
 return outcome;
}
