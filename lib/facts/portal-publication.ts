import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { samePlatformTenant } from "../control-plane/discovery/platform-enumeration.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../reader/cache.ts";
import {openBlank,type FactDb} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";

/** Withdraw this unconfirmed source, retaining identities, saved copies and other publishers' facts. */
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
    const facts = await query(`WITH RECURSIVE subjects AS (
      SELECT id FROM entity WHERE id=ANY($1::text[])
      UNION SELECT e.id FROM entity e JOIN subjects s ON e.parent_id=s.id WHERE e.kind='meeting'
    ) SELECT f.id,f.entity_id,s.url,s.final_url FROM subjects e JOIN fact f ON f.entity_id=e.id
      JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live' AND f.provenance_kind<>'OWNER'`,[[...scopes]]);
    const ids = facts.filter(f => [f.url,f.final_url].some(url => typeof url === 'string' && samePlatformTenant(url,portal))).map(f => f.id);
    if (ids.length) await query("UPDATE fact SET status='pulled',held_reason='PORTAL_AUTHORITY_UNCONFIRMED' WHERE id=ANY($1::bigint[]) AND status='live'",[ids]);
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
export async function confirmPlatformPublication(db:FactDb,door:DoorRecord):Promise<void> {
  const partition=meetingPartitionOfId(door.doorId);
  if(!partition) return;
  await db.transaction(query=>query("DELETE FROM blank WHERE entity_id=ANY($1::text[]) AND field=ANY($2::text[]) AND reason='PORTAL_AUTHORITY_UNCONFIRMED'",
    [door.bodyIds,[`calendar:${partition.scope}`,`calendar:${partition.scope}:history`]]));
}
