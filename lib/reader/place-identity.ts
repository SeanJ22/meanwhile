import { publishedBodyLabel } from "../civic-data/published-body-name.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import type { Meeting } from "../sources/types.ts";

export type BodyHeaders = Readonly<Record<string,{readonly id:string;readonly name:string}>>;
type Row=Record<string,unknown>;

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

/** Only transient identity columns change. Keep original IDs until the ready-row merger assigns ownership. A ZIP keeps the name facts a board is published under. */
export function currentPlaceRow(row:Row,headers:BodyHeaders,zip=false):Row {
  const identity=placeIdentity(headers),records=(value:unknown)=>Array.isArray(value)?value as Row[]:[];
  return {...row,body_aliases:identity.aliases,
    entities:records(row.entities).map(body=>({...body,name:identity.name(String(body.id),body.name as string|null)})),
    fields:records(row.fields).filter(field=>zip || field.field!=='name' || typeof field.value!=='string'
      || publishedBodyLabel(field.value).kind==='body')};
}
