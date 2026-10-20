import { retainedInputs } from './inputs.ts';
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { readHeldPlaceCapture, type HeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { scoreTargets } from "../admin-view/place-target-scores.ts";
import { stateDivisionId } from "../admin-view/v6-national-geography.ts";
import { keeperState } from "./state.ts";
import { setActiveOwedOverlay } from "../../coverage/owed-overlay.ts";
import { meetingFreshnessHours } from '../../coverage/checklist-map.ts';
import { buildPlaceOwedList } from '../../coverage/place-owed.ts';
import { placeMeasures } from '../../coverage/place-measures.ts';

export interface CountryScore { readonly state:string; readonly score:number|null; readonly measuredAt:string; readonly error:string|null;readonly freshness?:{readonly n:number;readonly of:number} }
export interface CountryCache extends CountryScore {readonly capture:HeldPlaceCapture|null;readonly inputs?:Readonly<Record<string,string>>}
const PREFIX="line-keeper:country:";
const ids=US_STATES.map(s=>PREFIX+s.code);
/** No civic records or score inputs are downloaded by the Admin reader. */
export const COUNTRY_SQL=`SELECT value - 'capture' - 'inputs' AS value FROM cp_owner_snapshots WHERE id=ANY($1::text[])`;
export async function readCountryScores(sql:Sql):Promise<readonly CountryScore[]> {
  const rows=await boundedQuery(sql,{operation:"line-keeper.country-scores",callClass:"PAGE"},COUNTRY_SQL,[ids]) as {value:CountryScore}[];
  return rows.map(r=>r.value);
}
/** Only changed source pointers and source confirmations invalidate retained inputs. */
export const COUNTRY_CHANGES_SQL=`SELECT scope AS place,record_class,scope FROM civic_data_promotions
 WHERE promoted_at >= $1::timestamptz AND promoted_at <= greatest($2::timestamptz,statement_timestamp())
 UNION SELECT c.scope,c.record_class,c.scope FROM civic_data_candidate_events e JOIN civic_data_candidates c ON c.id=e.candidate_id
 WHERE e.at >= $1::timestamptz AND e.at < $2::timestamptz AND e.detail LIKE 'UNCHANGED_CONFIRMATION_%'`;
export function captureAt(capture:HeldPlaceCapture,at:string):HeldPlaceCapture {
  const starts=new Map(capture.subjects.filter(s=>s.captureKind==='meeting'&&s.startsAt).map(s=>[s.id,s.startsAt!]));
  return {...capture,held:capture.held.map(h=>h.state==='published'&&starts.has(h.subjectId)?{...h,
    freshUntil:new Date(Date.parse(h.checkedAt)+meetingFreshnessHours(starts.get(h.subjectId)!,at)*3_600_000).toISOString()}:h)};
}
export async function publishCountryScores(control:Sql,reader:Sql,from:string,through:string,at:string,options:{initialize?:boolean;readOnly?:boolean;previewCache?:readonly CountryCache[];onCache?:(row:CountryCache)=>void}={}) {
  if(options.previewCache&&!options.readOnly)throw Error('Injected country inputs are only allowed for a read-only preview');
  const [saved,changed,overlayRows]=await Promise.all([
    options.previewCache?Promise.resolve(options.previewCache.map(value=>({value}))):boundedQuery(control,{operation:'line-keeper.country-inputs',callClass:'PAGE'},"SELECT value - 'inputs' AS value FROM cp_owner_snapshots WHERE id=ANY($1::text[])",[ids]),
    options.initialize?Promise.resolve([]):boundedQuery(reader,{operation:"line-keeper.country-changes",callClass:"PAGE"},COUNTRY_CHANGES_SQL,[from,through]),
    boundedQuery(control,{operation:"line-keeper.owed-overlay",callClass:"POINT"},"SELECT value->'owedOverlay' AS overlay FROM cp_admin_config WHERE id='current'",[]),
  ]) as [{value:CountryCache}[],{place:string;record_class:string;scope:string}[],{overlay:Parameters<typeof setActiveOwedOverlay>[0]}[]];
  const caches=new Map(saved.map(r=>[r.value.state,r.value]));
  const consumed=new Set(['REGISTRY_RUNTIME_BINDING','MEETING','MEETING_OUTCOME','STATE_LEGISLATOR','FEDERAL_DIRECTORY','FEC_FUNDING','STATE_CAMPAIGN_FINANCE','CURATED_READER_RECORD','BALLOT_CANDIDACY','CANDIDATE_PROFILE','CANDIDATE_PUBLICATION','VOTING_SITE','CENSUS_GEOGRAPHY']);
  const relevant=changed.filter(r=>consumed.has(r.record_class));
  const affected=new Set(relevant.flatMap(r=>{const state=keeperState(r.place??'','');return state?[state]:US_STATES.map(s=>s.code);}));
  setActiveOwedOverlay(overlayRows[0]?.overlay??null);
  const scores:CountryScore[]=[];
  for(const {code:state} of US_STATES){
    const id=stateDivisionId(state);if(!id)continue;
    let capture=caches.get(state)?.capture??null,error:string|null=caches.get(state)?.error??null;
    let inputs:Record<string,string>|undefined;
    if(options.initialize||affected.has(state)){
      error=null;
      try{
        const held=options.previewCache?caches.get(state)?.inputs:(await boundedQuery(control,{operation:'line-keeper.country-state-inputs',callClass:'POINT'},
          "SELECT value->'inputs' AS inputs FROM cp_owner_snapshots WHERE id=$1",[PREFIX+state]) as {inputs:Record<string,string>|null}[])[0]?.inputs;
        const stateChanges=relevant.filter(r=>{const own=keeperState(r.place,'');return !own||own===state;});
        const retained=retainedInputs(held,(recordClass,scope)=>stateChanges.some(r=>r.record_class===recordClass&&(r.scope===scope||recordClass==='STATE_LEGISLATOR')),options.initialize);
        inputs=retained.inputs;
        capture=await readHeldPlaceCapture([id],{now:at},retained.memo);
      }catch(e){error=e instanceof Error?e.message:'The changed score inputs could not be read.';}
    }
    if(!capture)error??="The state's published score inputs have not been initialized.";
    const scored=capture?await scoreTargets([{placeKey:`st:${state}`,divisions:[{id,label:state.toUpperCase()}]}],{
      now:()=>at,readHeld:async()=>captureAt(capture!,at),
    }):new Map<string,number|null>();
    const current=capture?captureAt(capture,at):null;
    const freshness=current?placeMeasures(buildPlaceOwedList({divisions:[{id,label:state.toUpperCase()}],subjects:current.subjects,held:current.held,now:at})).freshness:undefined;
    const result:CountryCache={state,score:scored.get(`st:${state}`)??null,measuredAt:at,error,capture,...(inputs?{inputs}:{}),...(freshness?{freshness}:{})};
    options.onCache?.(result);
    scores.push({state,score:result.score,measuredAt:at,error,...(freshness?{freshness}:{})});
    if(!options.readOnly)await boundedQuery(control,{operation:'line-keeper.publish-country-score',callClass:'POINT'},
      `INSERT INTO cp_owner_snapshots(id,revision,updated_at,value) VALUES ($1,1,$2::timestamptz,$3::jsonb)
       ON CONFLICT(id) DO UPDATE SET revision=cp_owner_snapshots.revision+1,updated_at=excluded.updated_at,value=cp_owner_snapshots.value||excluded.value`,[PREFIX+state,at,JSON.stringify(result)]);
  }
  return scores;
}
