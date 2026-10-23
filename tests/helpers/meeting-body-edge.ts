import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import { snapshotCounts } from "../../lib/meetings/snapshot.ts";
import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";
import { provenEdgeEntry } from "./promoted-edge-entry.ts";
import { installCanonicalMeetings } from "./canonical-reader-fixtures.ts";
export interface EdgeBody { readonly bodyId:string; readonly divisions:readonly string[]; readonly meetings:readonly Meeting[] }
export async function publishMeetingBodies(_store:ReaderArtifactStore,now:string,bodies:readonly EdgeBody[]) {
  const held = new MemoryRoutineDataStore();
  for (const body of bodies) {
    const entry=provenEdgeEntry({recordClass:"MEETING",scope:`source:legistar:body:${encodeURIComponent(body.bodyId)}`,sourceId:"meetings-public-bodies",versionId:body.bodyId,
      retrievedAt:now,value:{formatVersion:1,generatedAt:now,counts:snapshotCounts([...body.meetings],0),sources:[],meetings:[...body.meetings],agendaDocuments:[]}});
    (held as unknown as {promotions:Map<string,unknown>}).promotions.set(entry.projection.key,entry.projection);
  }
  installCanonicalMeetings(held);
  return {status:"PUBLISHED"};
}
