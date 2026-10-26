import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import {openBlank,type FactDb,type Query} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";

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
        const inserted=await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$2,$3) ON CONFLICT DO NOTHING RETURNING id",
          [body,typeof door.config.bodyName==='string'?door.config.bodyName:body,/\/(?:state|district|territory):([a-z]{2})/.exec(door.ocdId ?? '')?.[1]?.toUpperCase() ?? null]);
        created.push(...inserted.map(row=>String(row.id)));
        scopes.add(body);
      }
    }
    const bodies=[...scopes];
    const partition = meetingPartitionOfId(door.doorId);
    if (partition) for (const body of bodies) for (const scope of [partition.scope,`${partition.scope}:history`])
      await openBlank(query,{entityId:body,field:`calendar:${scope}`,stage:'CHECK',reason:'PORTAL_AUTHORITY_UNCONFIRMED',detail:portal,retryMinutes:10});
    if(!created.length)return null;
    const scope=await portalScope(query,door,created);
    await enqueueReaderPlaces(scope,query);
    return scope;
  });
  if(changed)await invalidateReaderCache(changed,purge,null);
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
