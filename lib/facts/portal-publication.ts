import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import {openBlank,type FactDb,type Query} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";
import { ensureEntity } from "./entities.ts";
import { bodyNameKey, publishedBodyLabel } from "../civic-data/published-body-name.ts";
import { governingBoardName } from "../civic-data/governing-board-name.ts";
import { subBodyId } from "../civic-data/meeting-body-crosswalk.ts";
import { createHash } from "node:crypto";

async function portalScope(query:Query,door:DoorRecord,bodies:readonly string[]):Promise<ReaderCacheScope> {
  const scopes=await Promise.all(bodies.map(id=>readerCacheScopeForEntity(query,id)));
  return {entities:bodies,states:[...new Set(scopes.flatMap(scope=>scope.states ?? []))],
    places:[...new Set([door.ocdId,...(Array.isArray(door.config.alsoServesOcdIds)?door.config.alsoServesOcdIds:[])]
      .filter((id):id is string=>typeof id==='string' && id.startsWith('ocd-division/')))]};
}

/** Pause an unconfirmed source for a later check; its verified reader data stays held. */
export async function withdrawPlatformPublication(db: FactDb, door: DoorRecord, portal: string, purge?: ReaderCachePurger): Promise<void> {
  const changed = await db.transaction(async query => {
    const scopes=new Set<string>();
    const created:string[]=[];
    for(const body of door.bodyIds) {
      const canonical=await resolveId(body,query);
      if(canonical) scopes.add(canonical);
      else {
        const id=await ensureEntity(query,{id:body,kind:'body',name:typeof door.config.bodyName==='string'?door.config.bodyName:body,
          state:/\/(?:state|district|territory):([a-z]{2})/.exec(door.ocdId ?? '')?.[1]?.toUpperCase() ?? null,
          parentId:door.ocdId,government:typeof door.config.governmentId==='string'?door.config.governmentId:null});
        created.push(id);
        scopes.add(id);
      }
    }
    const bodies=[...scopes];
    const partition = meetingPartitionOfId(door.doorId);
    if (partition) for (const body of bodies) for (const scope of [partition.scope,`${partition.scope}:history`])
      await openBlank(query,{entityId:body,field:`calendar:${scope}`,stage:'CHECK',reason:'PORTAL_AUTHORITY_UNCONFIRMED',detail:portal,retryMinutes:10,countAttempt:true});
    if(!created.length)return null;
    const scope=await portalScope(query,door,created);
    await enqueueReaderPlaces({entities:scope.entities},query);
    return scope;
  });
  if(changed)await invalidateReaderCache(changed,purge,null);
}

/** Reconcile one state's small identity columns in one transaction; source bytes never leave the vault. */
export async function foldPortalBodyLabels(db: FactDb & { readonly query: Query }, state: string, purge?: ReaderCachePurger) {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Invalid body state");
  const result=await db.transaction(async query=>{
    const held=await query(`SELECT b.id,b.name,b.parent_id,p.name AS parent_name,p.kind AS parent_kind,x.entity_id AS canonical,
      EXISTS(SELECT 1 FROM fact WHERE entity_id=b.id) AS has_facts,
      EXISTS(SELECT 1 FROM entity WHERE parent_id=b.id AND kind='meeting') AS has_meetings
      FROM entity b LEFT JOIN entity p ON p.id=b.parent_id
      LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=b.id
      WHERE b.kind='body' AND b.state=$1 ORDER BY b.id`,[state]);
    const report={before:0,folded:0,meetings:0,unresolved:[] as string[]};
    const plans:{source:string;target:string;name:string;parent:string|null}[]=[];
    for(const row of held) {
      const label=publishedBodyLabel(String(row.name));
      if(label.kind==='body')continue;
      if(row.canonical && !row.has_facts && !row.has_meetings)continue;
      const source=String(row.id),parent=row.parent_id as string|null;
      const siblings=held.filter(other=>!other.canonical && other.id!==source
        && (parent && other.parent_id===parent || String(other.id).split('#')[0]===source.split('#')[0]));
      const key=` ${bodyNameKey(String(row.name))} `;
      const matched=siblings.filter(other=>publishedBodyLabel(String(other.name)).kind==='body')
        .map(other=>({other,at:key.indexOf(` ${bodyNameKey(String(other.name))} `)})).filter(x=>x.at>=0)
        .sort((a,b)=>a.at-b.at || String(b.other.name).length-String(a.other.name).length)[0]?.other;
      let target=row.canonical as string|undefined ?? (matched ? String(matched.id) : undefined);
      let name=matched ? String(matched.name) : label.name;
      const governing=siblings.find(other=>/#(?:governing|board)$/.test(String(other.id)) && publishedBodyLabel(String(other.name)).kind==='body');
      const context={name:row.parent_name as string|null,school:/:school:|:depschool:|school_district:/.test(parent??source),
        special:/:special:/.test(parent??source),county:/:county:|\/county:[^/]+$/.test(parent??source.split('#')[0]!)};
      if(!target && label.name && governingBoardName(label.name,context)!==null)target=governing ? String(governing.id) : undefined;
      if(!target && !label.name)target=governing ? String(governing.id) : undefined;
      if(!target && /#(?:governing|board)$/.test(source) && parent && row.parent_name
        && ['government','place'].includes(String(row.parent_kind))
        && !/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(parent)) {
        target=source;
        name=label.name && governingBoardName(label.name,context) || governingBoardName(String(row.name),context)
          || `${String(row.parent_name)} ${context.school?'school board':'governing board'}`;
      }
      if(!target && parent && label.name)target=subBodyId(parent,label.name);
      if(!target && parent && /(?:government|place)/.test(String(row.parent_kind)) && !/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(parent)) {
        target=`${parent}${context.school?'#board':'#governing'}`;
        name=`${String(row.parent_name)} ${context.school?'school board':'governing board'}`;
      }
      if(row.canonical) {
        // A prior interrupted pass may have saved the identity before transferring its facts.
        if(!held.some(other=>other.id===target))continue;
      } else report.before++;
      if(!target || !name && !held.some(other=>other.id===target)) { report.unresolved.push(source);continue; }
      name=String(held.find(other=>other.id===target && publishedBodyLabel(String(other.name)).kind==='body')?.name ?? name);
      plans.push({source,target,name,parent});
      if(!row.canonical)report.folded++;
    }
    // Old unplaced inventory aliases may lack a state and government. An exact label on the exact native
    // publisher path can reuse its already identified counterpart; a shared vendor hostname alone cannot.
    const unplaced=await query(`SELECT orphan.id,orphan.name,array_agg(DISTINCT coalesce(x.entity_id,n.id)) AS matches
      FROM entity orphan JOIN entity_host oh ON oh.entity_id=orphan.id
      JOIN entity n ON n.kind='body' AND n.state=$1 AND n.name=orphan.name
      JOIN entity_host nh ON nh.entity_id=n.id AND nh.host=oh.host
      LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=n.id
      WHERE orphan.kind='body' AND orphan.state IS NULL AND orphan.parent_id IS NULL AND oh.host LIKE '%/%'
        AND NOT EXISTS(SELECT 1 FROM entity_external_id a WHERE a.scheme='body-alias' AND a.value=orphan.id)
      GROUP BY orphan.id,orphan.name`,[state]);
    for(const row of unplaced) {
      if(publishedBodyLabel(String(row.name)).kind==='body')continue;
      const matches=[...new Set((row.matches as string[]).map(id=>plans.find(plan=>plan.source===id)?.target ?? id))];
      if(matches.length!==1)continue;
      const target=matches[0]!,planned=plans.find(plan=>plan.target===target),body=held.find(body=>body.id===target);
      if(!planned && (!body || publishedBodyLabel(String(body.name)).kind!=='body'))continue;
      plans.push({source:String(row.id),target,name:planned?.name ?? String(body!.name),parent:planned?.parent ?? body!.parent_id as string|null});
      report.before++;report.folded++;
    }
    if(!plans.length)return {report,scope:null};
    const sources=plans.map(p=>p.source),targets=plans.map(p=>p.target),names=plans.map(p=>p.name),parents=plans.map(p=>p.parent);
    await query(`INSERT INTO entity(id,kind,name,state,parent_id) SELECT DISTINCT ON(id) id,'body',name,$5,parent
      FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) p(source,id,name,parent)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name WHERE entity.id=ANY($1::text[])`,[sources,targets,names,parents,state]);
    await query(`WITH subjects AS MATERIALIZED (SELECT unnest($1::text[]) AS id UNION SELECT unnest($2::text[])),
      live AS MATERIALIZED(SELECT f.* FROM subjects s CROSS JOIN LATERAL
        (SELECT id,entity_id,field,provenance_kind,checked_at FROM fact WHERE entity_id=s.id AND status='live' OFFSET 0) f),
      ranked AS (SELECT f.id,row_number() OVER(PARTITION BY coalesce(p.target,f.entity_id),f.field
      ORDER BY CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 ELSE 2 END,
        f.checked_at DESC,f.id DESC) AS position FROM live f LEFT JOIN unnest($1::text[],$2::text[]) p(source,target) ON p.source=f.entity_id
      WHERE f.field<>'name'), losing AS MATERIALIZED(SELECT id FROM ranked WHERE position>1
        UNION SELECT id FROM live WHERE entity_id=ANY($1::text[]) AND field='name')
      UPDATE fact SET status='superseded' WHERE id=ANY(ARRAY(SELECT id FROM losing))`,[sources,targets]);
    await query(`UPDATE fact SET entity_id=p.target FROM unnest($1::text[],$2::text[]) p(source,target)
      WHERE entity_id=p.source AND p.source<>p.target`,[sources,targets]);
    await query(`INSERT INTO entity_host(entity_id,host,proved_by) SELECT p.target,h.host,h.proved_by FROM entity_host h
      JOIN unnest($1::text[],$2::text[]) p(source,target) ON p.source=h.entity_id ON CONFLICT DO NOTHING`,[sources,targets]);
    await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
      SELECT p.target,h.place_id,h.boundary_year,h.placement_basis FROM entity_place h
      JOIN unnest($1::text[],$2::text[]) p(source,target) ON p.source=h.entity_id ON CONFLICT DO NOTHING`,[sources,targets]);
    await query(`UPDATE entity_external_id SET entity_id=p.target FROM unnest($1::text[],$2::text[]) p(source,target)
      WHERE entity_id=p.source AND p.source<>p.target`,[sources,targets]);
    await query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT target,'body-alias',source
      FROM unnest($1::text[],$2::text[]) p(source,target) WHERE source<>target ON CONFLICT DO NOTHING`,[sources,targets]);
    const meetings=await query(`UPDATE entity SET parent_id=p.target FROM unnest($1::text[],$2::text[]) p(source,target)
      WHERE kind='meeting' AND parent_id=p.source AND p.source<>p.target RETURNING id`,[sources,targets]);
    report.meetings=meetings.length;
    const entities=[...new Set([...sources,...targets])];
    const pages=await query(`SELECT page_id AS id FROM place_page_dependency WHERE entity_id=ANY($1::text[])
      UNION SELECT place_id AS id FROM place_page WHERE place_id=ANY($1::text[])`,[entities]);
    const scope={states:[state],entities,places:pages.map(row=>String(row.id))};
    await enqueueReaderPlaces({entities:scope.entities},query);
    return {report,scope};
  });
  if(result.scope)await invalidateReaderCache(result.scope,purge,null);
  return result.report;
}

/** The standing identity pass applies an importer change once; unchanged turns read only its fingerprint. */
export async function ensurePortalBodyLabels(db: FactDb & { readonly query: Query }, state: string, purge?: ReaderCachePurger): Promise<boolean> {
  const source=`portal-body-labels:${state}`;
  const fingerprint=createHash('sha256').update(publishedBodyLabel.toString()).update(bodyNameKey.toString()).update(foldPortalBodyLabels.toString()).digest('hex');
  const [held]=await db.query("SELECT sha256 FROM fact_store_load WHERE source=$1",[source]);
  if(held?.sha256===fingerprint)return false;
  const report=await foldPortalBodyLabels(db,state,purge);
  if(report.unresolved.length)throw new Error(`BODY_IDENTITY_UNRESOLVED: ${report.unresolved.length} calendar labels still need their owner`);
  await db.query(`INSERT INTO fact_store_load(source,sha256) VALUES($1,$2)
    ON CONFLICT(source) DO UPDATE SET sha256=EXCLUDED.sha256,loaded_at=now()`,[source,fingerprint]);
  return true;
}

/** A newly observed government link closes the retry; the next Door read confirms or replaces facts. */
export async function confirmPlatformPublication(db:FactDb,door:DoorRecord,_purge?:ReaderCachePurger):Promise<void> {
  const partition=meetingPartitionOfId(door.doorId);
  if(!partition) return;
  await db.transaction(async query=>{
    const bodies=await Promise.all(door.bodyIds.map(async id=>await resolveId(id,query) ?? id));
    await query("DELETE FROM blank WHERE entity_id=ANY($1::text[]) AND field=ANY($2::text[]) AND reason='PORTAL_AUTHORITY_UNCONFIRMED'",
      [bodies,[`calendar:${partition.scope}`,`calendar:${partition.scope}:history`]]);
  });
}
