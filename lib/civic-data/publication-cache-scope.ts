import { readerCacheScopeForPublication, type ReaderCacheScope } from "../reader/cache.ts";
import type { RoutineCandidate } from "./types.ts";

/** A writer already owns the next facts, the departing facts and its merge base's small footprint. */
export function publicationCacheScope(candidate:RoutineCandidate,previous?:ReaderCacheScope):ReaderCacheScope {
  const before=[...candidate.changeSet?.changed??[],...candidate.changeSet?.removed??[]].map(delta=>delta.before);
  const next=readerCacheScopeForPublication(candidate.scope,{recordClass:candidate.recordClass,readModels:[candidate.readModel,...before]});
  const union=(key:"states"|"places"|"entities")=>[...new Set([...(next[key]??[]),...(previous?.[key]??[])])];
  return {...next,...(previous?.states?.length?{states:union("states")}:{}),
    ...(previous?.places?.length?{places:union("places")}:{}),...(previous?.entities?.length?{entities:union("entities")}:{}),
    ...(previous?.national?{national:true}:{}),...(previous?.nationalPeople?{nationalPeople:true}:{})};
}
