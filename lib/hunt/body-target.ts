import {huntBodySubject} from './finding-subject.ts';
import {readCheckEntity} from '../facts/entity-read.ts';
import {checkFact,hostOf} from '../facts/check.ts';
import {captureProvenance} from '../facts/capture.ts';
import {saveCaptureCopy} from '../facts/source-copy.ts';
import type {FactDb,Query,Clocks} from '../facts/publish.ts';
import type {WorkerPublicationCapture} from '../civic-data/worker-roster-publication.ts';

/** The type stated in the sourced name, rather than an invented board. */
const bodyTypeWord=(name:string):string|null=>/\b(?:agency|council|commission|assembly|board|committee|selectboard|selectmen|trustees)\b/i.exec(name)?.[0]??null;

/** A newly sourced body needs a name and its source, just as an existing body
 * does. Its government's native identity and state remain the parent. */
export async function ensureHuntBodyTarget(input:{facts:FactDb&{query:Query};subjectId:string;name:string;quote:string;capture:WorkerPublicationCapture;clocks:Clocks;now:Date}){
 if(!bodyTypeWord(input.name) || input.capture.httpStatus!==200 || input.capture.partial)return null;
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
 const id=huntBodySubject(input.subjectId,input.name);
 const other=await input.facts.query("SELECT id FROM entity WHERE parent_id=$1 AND kind='body' AND lower(name)=lower($2) AND id<>$3 LIMIT 1",[government.id,input.name,id]);
 if(other.length)return null;
 const existing=await input.facts.query('SELECT id,name,state,parent_id,kind FROM entity WHERE id=$1',[id]);
 if(existing.length && (existing[0].kind!=='body' || existing[0].state!==government.state || existing[0].parent_id!==government.id))return null;
 if(!existing.length)await input.facts.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body',$2,$3,$4) ON CONFLICT DO NOTHING`,[id,input.name,government.state,government.id]);
 // Preserve the government's held division relation, including registrations
 // whose parent is their place but which have no separate entity_place row.
 await input.facts.query(`INSERT INTO entity_place(entity_id,place_id)
   SELECT $1,place_id FROM entity_place WHERE entity_id=$2
   UNION SELECT $1,p.id FROM entity p WHERE p.id=$3 AND p.kind='place' ON CONFLICT DO NOTHING`,[id,government.id,government.parent_id]);
 return existing.length?{id:String(existing[0].id),name:String(existing[0].name),state:existing[0].state as string|null,parentId:existing[0].parent_id as string|null}:{id,name:input.name,state:government.state as string|null,parentId:String(government.id)};
}

