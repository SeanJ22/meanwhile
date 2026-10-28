import { publishedBodyLabel } from "../civic-data/published-body-name.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import type { PlacePackage } from "./place-types.ts";
import type { Meeting } from "../sources/types.ts";
import { mergeReaderSittings } from "../meetings/sitting-merge.ts";

export type BodyHeaders = Readonly<Record<string,{readonly id:string;readonly name:string}>>;
type Row=Record<string,unknown>;
const unique=<T>(rows:readonly T[],key:(row:T)=>string):T[]=>[...new Map(rows.map(row=>[key(row),row])).values()];
const currentMeetings=(rows:readonly Meeting[]):Meeting[]=>{
  const groups=new Map<string,Meeting[]>();
  for(const row of rows){const key=JSON.stringify([row.id,row.bodyId]);groups.set(key,[...groups.get(key)??[],row]);}
  return [...groups.values()].flatMap(group=>group.length===1?group:mergeReaderSittings(group).rows);
};

/** Current identity columns accompany cached answers; source data stays on its existing cache path. */
export function placeIdentity(headers:BodyHeaders) {
  const id=(value:string)=>headers[value]?.id ?? value;
  const name=(body:string,value:string|null|undefined)=>headers[body] && (id(body)!==body
    || typeof value==='string' && publishedBodyLabel(value).kind!=='body') ? headers[body].name : value;
  const meeting=(row:Meeting):Meeting=>row.bodyId ? {...row,bodyId:id(row.bodyId),bodyName:name(row.bodyId,row.bodyName) ?? row.bodyName} : row;
  const roster=(row:BodyRoster):BodyRoster=>({...row,bodyId:id(row.bodyId),bodyName:name(row.bodyId,row.bodyName) ?? row.bodyName});
  const snapshot=(row:MeetingsSnapshot):MeetingsSnapshot=>({...row,meetings:row.meetings.map(meeting),
    ...(row.derivedMembers?{derivedMembers:row.derivedMembers.map(member=>({...member,bodyId:id(member.bodyId)}))}:{})});
  const aliases=Object.fromEntries(Object.entries(headers).filter(([source,header])=>source!==header.id).map(([source,header])=>[source,header.id]));
  return {id,name,meeting,roster,snapshot,aliases};
}

/** Only transient identity columns change. Keep original IDs until the ready-row merger assigns ownership. */
export function currentPlaceRow(row:Row,headers:BodyHeaders):Row {
  const identity=placeIdentity(headers),records=(value:unknown)=>Array.isArray(value)?value as Row[]:[];
  return {...row,body_aliases:identity.aliases,
    entities:records(row.entities).map(body=>({...body,name:identity.name(String(body.id),body.name as string|null)})),
    fields:records(row.fields).filter(field=>field.field!=='name' || typeof field.value!=='string'
      || publishedBodyLabel(field.value).kind==='body')};
}

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
