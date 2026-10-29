import type {MemberOfficeSlice} from "../officials/member-office-data.ts";
import {memberOfficeStateScope} from "../officials/member-office-scope.ts";
import type {Query} from "../facts/publish.ts";
import {authorityPageId} from "./page-authorities.ts";
import {buildMissingPlacePages} from "./place-builder.ts";

export function selectedMemberOfficeSlice(slice:MemberOfficeSlice|null,members:readonly string[]):MemberOfficeSlice|null {
  if(!slice||!members.length)return slice;
  const ids=new Set(members);
  return {...slice,records:slice.records.filter(record=>ids.has(record.officeholderId))};
}

/** Offices and their Checked metadata were selected when the place's officials were built. */
export async function readReadyMemberOffices(query:Query,state:string,members:readonly string[]=[]):Promise<MemberOfficeSlice|null> {
  const id=authorityPageId(`CURATED_READER_RECORD:${memberOfficeStateScope(state)}`);
  const read=()=>query(`SELECT (office.value-'records')||jsonb_build_object('records',coalesce((
    SELECT jsonb_agg(record ORDER BY ordinal) FROM jsonb_array_elements(office.value->'records') WITH ORDINALITY records(record,ordinal)
      WHERE cardinality($2::text[])=0 OR record->>'officeholderId'=ANY($2::text[])),'[]'::jsonb)) AS value,
    context->>'authorityFormat' AS format FROM place_page page CROSS JOIN LATERAL
      (SELECT coalesce(context->'authorityGeographies'->$3,context->'authorityGeography')->'member_offices' AS value) office WHERE place_id=$1`,[id,[...members],state]);
  let [page]=await read();
  if(page?.format!=='1'){
    await buildMissingPlacePages([{id,kind:'place',state,authorities:true}]);
    [page]=await read();
  }
  return selectedMemberOfficeSlice(page?.value as MemberOfficeSlice??null,members);
}
