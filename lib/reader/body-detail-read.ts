import type {Query} from '../facts/publish.ts';
import type {ReaderBodyDetail} from './body-detail.ts';
import {readSavedBodyRoster} from './body-roster.ts';
import {buildMissingPlacePages} from './place-builder.ts';
import {unpackReadyPlace} from './place-ready.ts';

/** Cards and Ask consume the body's already composed page by its exact identity. */
export async function readBodyDetail(query:Query,state:string,bodyId:string):Promise<ReaderBodyDetail> {
  let held=await readSavedBodyRoster(query,bodyId);
  if(!held){
    await buildMissingPlacePages([{id:bodyId,kind:'body',state,roster:true}]);
    held=await readSavedBodyRoster(query,bodyId);
  }
  if(!held)throw Error('BODY_DETAIL_NOT_FOUND');
  const [saved]=await query("SELECT p.body,e.state FROM place_page p JOIN entity e ON e.id=p.place_id WHERE p.place_id=$1",[held.id]);
  if(saved.state!==state)throw Error('BODY_DETAIL_WRONG_STATE');
  const place=unpackReadyPlace(saved.body);
  return {bodyId,roster:held.roster,fieldSources:place.registry?.registry.bodies.find(body=>body.id===held.id)?.fieldSources
    ??place.bodies.find(body=>body.id===held.id)?.fields.fieldSources};
}
