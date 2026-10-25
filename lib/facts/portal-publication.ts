import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../reader/cache.ts";
import {openBlank,type FactDb} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";

/**
 * Hold this unconfirmed source's calendar back from readers, retaining identities, saved copies and every fact. A fact changes
 * only through the front door (lib/core/door.ts): the open blank and the suspended door keep the calendar off reader pages
 * until the government's own site links the portal again, and the next read through the door replaces or confirms its facts.
 */
export async function withdrawPlatformPublication(db: FactDb, door: DoorRecord, portal: string, purge?: ReaderCachePurger): Promise<void> {
  const changed = await db.transaction(async query => {
    const scopes=new Set<string>();
    for(const body of door.bodyIds) {
      const canonical=await resolveId(body,query);
      if(canonical) scopes.add(canonical);
      else {
        await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body',$2,$3) ON CONFLICT DO NOTHING",
          [body,typeof door.config.bodyName==='string'?door.config.bodyName:body,/\/(?:state|district|territory):([a-z]{2})/.exec(door.ocdId ?? '')?.[1]?.toUpperCase() ?? null]);
        scopes.add(body);
      }
    }
    const partition = meetingPartitionOfId(door.doorId);
    if (partition) for (const body of scopes) for (const scope of [partition.scope,`${partition.scope}:history`])
      await openBlank(query,{entityId:body,field:`calendar:${scope}`,stage:'CHECK',reason:'PORTAL_AUTHORITY_UNCONFIRMED',detail:portal,retryMinutes:10});
    const host = new URL(portal).hostname.toLowerCase();
    await query("DELETE FROM entity_host WHERE entity_id=ANY($1::text[]) AND host=$2",[[...scopes],host]);
    return Promise.all([...scopes].map(id => readerCacheScopeForEntity(query,id)));
  });
  for (const scope of changed) if (scope) await invalidateReaderCache(scope,purge);
}

/** A newly observed government link closes this source's standing blank; normal acquisition refreshes its facts. */
export async function confirmPlatformPublication(db:FactDb,door:DoorRecord,purge?:ReaderCachePurger):Promise<void> {
  const partition=meetingPartitionOfId(door.doorId);
  if(!partition) return;
  const changed=await db.transaction(async query=>{
    const bodies=await Promise.all(door.bodyIds.map(async id=>await resolveId(id,query) ?? id));
    const removed=await query("DELETE FROM blank WHERE entity_id=ANY($1::text[]) AND field=ANY($2::text[]) AND reason='PORTAL_AUTHORITY_UNCONFIRMED' RETURNING entity_id",
      [bodies,[`calendar:${partition.scope}`,`calendar:${partition.scope}:history`]]);
    return Promise.all([...new Set(removed.map(row=>String(row.entity_id)))].map(id=>readerCacheScopeForEntity(query,id)));
  });
  for(const scope of changed) if(scope) await invalidateReaderCache(scope,purge);
}
