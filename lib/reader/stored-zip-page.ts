import { snapshotCounts, type MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import type { Meeting } from "../sources/types.ts";
import { mergeReaderSittings } from "../meetings/sitting-merge.ts";
import type { Query } from "../facts/publish.ts";
import { identityCtes, identityHeaders } from "./place.ts";
import { placeIdentity, type BodyHeaders } from "./place-identity.ts";
import { unpackPlaceContextRow } from "./place-ready.ts";
import type { PlacePackage } from "./place-types.ts";

/*
 * The ZIP page as it was stored before ZIPs were combined from their places' saved pages, read exactly as it was read then (the
 * page, with the current identity of the boards it names). It answers a ZIP only while a place the ZIP touches has no saved
 * content yet; nothing writes it now. It goes when every place is built, with the contract migration that drops those pages.
 */

type Row=Record<string,unknown>;
const unique=<T>(rows:readonly T[],key:(row:T)=>string):T[]=>[...new Map(rows.map(row=>[key(row),row])).values()];
const currentMeetings=(rows:readonly Meeting[]):Meeting[]=>{
  const groups=new Map<string,Meeting[]>();
  for(const row of rows){const key=JSON.stringify([row.id,row.bodyId]);groups.set(key,[...groups.get(key)??[],row]);}
  return [...groups.values()].flatMap(group=>group.length===1?group:mergeReaderSittings(group).rows);
};

const mergeRoster=(a:BodyRoster|null,b:BodyRoster|null):BodyRoster|null=>a&&b?{...a,...b,members:unique([...a.members,...b.members],member=>member.id)}:b??a;
function mergeSnapshots(a:MeetingsSnapshot,b:MeetingsSnapshot):MeetingsSnapshot {
  const meetings=currentMeetings([...a.meetings,...b.meetings]);
  const latest=Date.parse(a.generatedAt)>Date.parse(b.generatedAt)?a:b;
  return {...a,...b,...latest,meetings,counts:snapshotCounts(meetings,0),sources:[...a.sources,...b.sources],
    agendaDocuments:unique([...a.agendaDocuments,...b.agendaDocuments],document=>document.id),
    ...(a.derivedMembers||b.derivedMembers?{derivedMembers:unique([...a.derivedMembers??[],...b.derivedMembers??[]],member=>member.id)}:{})};
}

/** A queued identity correction applies immediately to saved ZIP/body answers, without rebuilding their facts. */
export function currentReadyPlace(pages:readonly PlacePackage[],headers:BodyHeaders):PlacePackage {
  if(pages.length===1&&!Object.keys(headers).length)return pages[0]!;
  const identity=placeIdentity(headers),base=pages[0]!,bodies=new Map<string,BodyFacts>();
  const held=pages.flatMap(page=>page.bodies).sort((a,b)=>Number(a.id===identity.id(a.id))-Number(b.id===identity.id(b.id)));
  for(const body of held) {
    const id=identity.id(body.id),prior=bodies.get(id);
    const fields={...prior?.fields,...body.fields,
      ...(body.fields.name?{name:identity.name(body.id,body.fields.name) ?? body.fields.name}:{}),
      ...(body.fields.registeredName?{registeredName:identity.name(body.id,body.fields.registeredName) ?? body.fields.registeredName}:{})};
    bodies.set(id,{...prior,...body,id,name:identity.name(body.id,body.name) ?? body.name,fields,
      roster:mergeRoster(prior?.roster??null,body.roster?identity.roster(body.roster):null),
      comment:body.comment?{...body.comment,bodyId:id}:prior?.comment??null,
      dispositions:unique([...prior?.dispositions??[],...body.dispositions],row=>row.sourceId),
      sittings:unique([...prior?.sittings??[],...body.sittings],row=>`${row.meetingId}:${row.field}`)});
  }
  const registries=pages.flatMap(page=>page.registry?[page.registry]:[]),registry=registries[0];
  const rosters=new Map<string,BodyRoster>();
  for(const original of registries.flatMap(row=>row.bodyRosters)) {
    const row=identity.roster(original);
    rosters.set(row.bodyId,mergeRoster(rosters.get(row.bodyId)??null,row)!);
  }
  const snapshots=new Map<string,MeetingsSnapshot>();
  for(const page of pages)for(const [body,row] of Object.entries(page.bodySnapshots)) {
    const id=identity.id(body),value=identity.snapshot(row),prior=snapshots.get(id);
    snapshots.set(id,prior?mergeSnapshots(prior,value):value);
  }
  return {...base,bodies:[...bodies.values()],meetings:currentMeetings(pages.flatMap(page=>page.meetings.map(identity.meeting))),
    snapshot:pages.map(page=>identity.snapshot(page.snapshot)).reduce(mergeSnapshots),bodySnapshots:Object.fromEntries(snapshots),
    agendaDocumentLinks:unique(pages.flatMap(page=>page.agendaDocumentLinks),row=>`${row.meetingId}:${row.documentUrl}`),
    registry:registry?{...registry,registry:{...registry.registry,bodies:unique(registries.flatMap(row=>row.registry.bodies)
      .map(body=>({...body,id:identity.id(body.id),name:identity.name(body.id,body.name) ?? body.name})),body=>body.id)},bodyRosters:[...rosters.values()]}:null};
}

const storedZipPageSql = () => `WITH selected AS (SELECT $1::text AS id), ${identityCtes}
SELECT body AS page,${identityHeaders()} AS body_headers FROM place_page WHERE place_id=$1`;

/** The stored page of a ZIP, or null when it has none. */
export async function readStoredZipPage(zip: string, query: Query): Promise<PlacePackage | null> {
  const [saved] = await query(storedZipPageSql(), [zip]);
  return saved?.page ? currentReadyPlace([unpackPlaceContextRow(saved.page) as unknown as PlacePackage], saved.body_headers as BodyHeaders ?? {}) : null;
}
