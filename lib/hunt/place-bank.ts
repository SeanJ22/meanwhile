import type { Query } from '../facts/publish.ts';
import type { PlaceCapture } from './place-plan.ts';
import { readFactRosters } from '../facts/roster-read.ts';
import { bodyFieldsFromRows } from '../facts/registry-overlay.ts';
import { withStateRegistryFacts } from '../registry/state-composition.ts';
import { FRESHNESS_HOURS } from '../coverage/checklist-map.ts';
import { projectHeldPlaceCapture } from '../civic-data/held-place-projection.ts';
import { requireRegistryState,stateRegistryRuntimeScope,stateBallotScope } from '../civic-data/state-scopes.ts';
import { federalDirectoryScope } from '../officials/federal-directory-data-plane.ts';
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from '../state-rollcalls/authority.ts';
import { requiredRoutineContract,ROUTINE_SOURCE_CONTRACTS } from '../civic-data/contracts.ts';
import { requiredManualProductionContract } from '../civic-data/manual-contracts.ts';
import type { HeldPlaceFamilies } from '../civic-data/held-place-families.ts';
import type { RegistryRuntimeReadModel } from '../registry/runtime-data-plane.ts';
import { MEETING_PARTITION_CONTRACTS } from '../civic-data/meeting-partitions.ts';
import { readPlacePointerSlices } from '../civic-data/held-place-slices.ts';
import type { MeetingsSnapshot } from '../meetings/snapshot.ts';
import type { OutcomeSnapshot } from '../outcomes/types.ts';

/** Existing canonical payload functions select the place on the database
 * server. A hunt reads a capture view, never a whole state publication. */
export async function readScopedBank(query:Query,ids:readonly string[],state:string,now:string=new Date().toISOString()):Promise<PlaceCapture>{
  state=requireRegistryState(state);
  if(ids.some(id=>{const own=/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]??/^([a-z]{2}):/.exec(id)?.[1]??/^government:US-([a-z]{2}):/i.exec(id)?.[1];return own && own.toUpperCase()!==state;}))throw new Error('HUNT_BANK_CROSS_STATE');
  const requestedIds=ids;
  const nativeScope=ids.every(id=>!id.startsWith('ocd-division/'));
  if(nativeScope){
    const parents=await query("SELECT parent_id FROM entity WHERE id=ANY($1::text[]) AND kind='government' AND state=$2 AND parent_id LIKE 'ocd-division/%'",[[...ids],state]);
    const canonical=parents.map(row=>String(row.parent_id));
    if(canonical.some(id=>/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase()!==state))throw new Error('HUNT_BANK_CROSS_STATE');
    ids=[...new Set([...ids,...canonical])];
  }
  const scope=stateRegistryRuntimeScope(state);
  const nativeBodies=await query(`SELECT DISTINCT b.id,b.name,b.parent_id FROM entity b
    LEFT JOIN entity_place ep ON ep.entity_id=b.id
    WHERE b.kind='body' AND b.state=$2 AND (b.id=ANY($1::text[]) OR b.parent_id=ANY($1::text[]) OR ep.place_id=ANY($1::text[])
      OR b.parent_id IN (SELECT g.id FROM entity g WHERE g.kind='government' AND g.parent_id=ANY($1::text[])))`,[[...ids],state]);
  const [reg]=await query(`WITH picked AS (
      SELECT current_version_id,payload,reader_payload_slice(payload,$2::text[]) AS value
      FROM civic_data_promotions WHERE key=$1
    ), body_slice AS (
      SELECT current_version_id,payload,reader_payload_slice(payload,$2::text[] || ARRAY(
        SELECT id#>>'{}' FROM jsonb_path_query(value,'$.registry.bodies[*].id') id
      )) AS value FROM picked
    ), member_ids AS (
      SELECT body_slice.*,ARRAY(SELECT DISTINCT id#>>'{}' FROM (
        SELECT jsonb_path_query(value,'$.bodyRosters[*].members[*].id') AS id
        UNION ALL SELECT jsonb_path_query(value,'$.statewideExecutives[*].holder.id')
        UNION ALL SELECT jsonb_path_query(value,'$.officialCandidacies.rows[*].holder.id')
      ) members WHERE jsonb_typeof(id)='string') AS ids FROM body_slice
    ) SELECT current_version_id,value || jsonb_build_object(
      'officialPhotos',reader_payload_slice(reader_payload_node(payload)->'officialPhotos',ids),
      'rosterPhotos',reader_payload_slice(reader_payload_node(payload)->'rosterPhotos',ids,'rosterPhotos')
    ) AS value FROM member_ids`,[`REGISTRY_RUNTIME_BINDING:${scope}`,[...ids,...nativeBodies.map(b=>String(b.id))]]);
  const held=(reg?.value??null) as RegistryRuntimeReadModel|null;
  const heldBodyIds=new Set(held?.registry.bodies.map(b=>b.id)??[]);
  const bodies=[...new Set([...heldBodyIds,...nativeBodies.map(b=>String(b.id))])];
  const rosters=bodies.length?await readFactRosters(query,bodies):{rosters:[],dispositions:[]};
  const bodyRows=bodies.length?await query(`SELECT f.entity_id,f.field,f.value,f.checked_at,s.url FROM fact f JOIN source_copy s ON s.id=f.source_copy_id
    WHERE f.entity_id=ANY($1::text[]) AND f.status='live' AND f.field=ANY($2::text[])`,[bodies,['name','homepage','office_address','office_phone','meeting_cadence','agenda_url','comment:attend','comment:detail','comment:time_limit']]):[];
  const bodyFields=bodyFieldsFromRows(bodyRows.filter(r=>!String(r.field).startsWith('comment:')));
  const carton={formatVersion:1,registry:{generatedAt:now,divisions:[],bodies:[]},bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],officialCandidacies:{formatVersion:1,rule:'EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE',rows:[]},officialPhotos:{photos:[]},rosterPhotos:{},...held};
  const selectedRegistry={...carton,registry:{...carton.registry,bodies:[...carton.registry.bodies,...nativeBodies.filter(b=>!heldBodyIds.has(String(b.id))).map(b=>({id:String(b.id),ocdId:ids[0],name:String(b.name),bodyClass:'UNKNOWN',provenance:{sourceUrl:null,collectedAt:now}}))]}} as unknown as RegistryRuntimeReadModel;
  const registry=withStateRegistryFacts(selectedRegistry,bodies.map(id=>({id,division:ids[0],fields:bodyFields[id]??{},roster:rosters.rosters.find(r=>r.bodyId===id)??null,dispositions:rosters.dispositions.filter(d=>rosters.rosters.find(r=>r.bodyId===id)?.members.some(m=>m.id===d.sourceId)),comment:null,sittings:[]})));
  const targets=[...ids,...bodies,...registry.bodyRosters.flatMap(r=>r.members.map(m=>m.id)),...registry.statewideExecutives.map(r=>r.holder.id)];
  const classes=ids.some(id=>id.startsWith('ocd-division/')) ? [['FEDERAL_DIRECTORY',federalDirectoryScope(state)],
    ...OFFICIAL_STATE_LEGISLATOR_TARGETS.filter(t=>t.state===state).map(t=>['STATE_LEGISLATOR',t.jurisdiction]),
    ['BALLOT_CANDIDACY',stateBallotScope('ballot-contests',state)],['VOTING_SITE',stateBallotScope('voting-sites',state)],
    ...(['official-filings','ballot-navigation'] as const).map(id=>{const c=requiredManualProductionContract(id);return[c.recordClass,c.scope];}),
    ...['fec-funding'].map(id=>{const c=requiredRoutineContract(id);return[c.recordClass,c.scope];})] : [];
  const rows=classes.length?await query(`WITH picked AS (
      SELECT record_class,scope,payload,reader_payload_slice(payload,$2::text[]) AS value
      FROM civic_data_promotions WHERE key=ANY($1::text[])
    ), sliced AS (SELECT record_class,scope,reader_payload_slice(payload,$2::text[] || ARRAY(
      SELECT DISTINCT id#>>'{}' FROM (
        SELECT jsonb_path_query(value,'$.roster.divisions[*].officeholderId') AS id
        UNION ALL SELECT jsonb_path_query(value,'$.ballots.*.contests[*].id')
      ) related WHERE jsonb_typeof(id)='string'
    )) AS value FROM picked)
    SELECT record_class,scope,CASE
      WHEN record_class IN ('FEDERAL_DIRECTORY','STATE_LEGISLATOR') THEN jsonb_build_object('roster',value->'roster')
      WHEN record_class='BALLOT_CANDIDACY' THEN jsonb_build_object('ballots',coalesce((
        SELECT jsonb_object_agg(k,v) FROM jsonb_each(coalesce(value->'ballots','{}'::jsonb)) b(k,v)
        WHERE jsonb_array_length(coalesce(v->'contests','[]'::jsonb))>0 OR jsonb_array_length(coalesce(v->'absences','[]'::jsonb))>0
      ),'{}'::jsonb)) ELSE value END AS value FROM sliced`,[classes.map(([c,s])=>`${c}:${s}`),targets]):[];
  const byClass=<T>(kind:string)=>rows.filter(r=>r.record_class===kind).map(r=>r.value as T);
  type Officials={roster?:NonNullable<HeldPlaceFamilies['rosters']>[number]};
  const federal=[...byClass<Officials>('FEDERAL_DIRECTORY'),...byClass<Officials>('STATE_LEGISLATOR')].flatMap(v=>v?.roster?[v.roster]:[]);
  const ballots=byClass<{ballots?:Record<string,NonNullable<HeldPlaceFamilies['ballots']>[number]>}>('BALLOT_CANDIDACY').flatMap(v=>Object.values(v.ballots??{})) as NonNullable<HeldPlaceFamilies['ballots']>[number][];
  const candidateIds=ballots.flatMap(b=>b.candidacies.map(c=>c.id));
  const profiles=candidateIds.length?await query(`SELECT record_class,scope,reader_payload_slice(payload,$2::text[]) AS value FROM civic_data_promotions WHERE key=ANY($1::text[])`,[
    ([['CANDIDATE_PROFILE','candidate-profiles'],['CANDIDATE_PUBLICATION','candidate-corpus'],['CURATED_READER_RECORD','candidate-campaign-sites-derived']] as const).map(([c,f])=>`${c}:${stateBallotScope(f,state)}`),[...targets,...candidateIds]]):[];
  type Curated={kind:'official-filings';records:NonNullable<HeldPlaceFamilies['filings']>}|{kind:'ballot-navigation';records:NonNullable<HeldPlaceFamilies['electionFields']>};
  const curated=byClass<Curated>('CURATED_READER_RECORD');
  const families:HeldPlaceFamilies={rosters:federal,ballots,candidateLineups:ballots.flatMap(b=>b.generalLineup?.contests??[]),
    votingSites:byClass<NonNullable<HeldPlaceFamilies['votingSites']>>('VOTING_SITE')[0]??null,funding:byClass<NonNullable<HeldPlaceFamilies['funding']>>('FEC_FUNDING')[0]??null,
    filings:curated.flatMap(v=>v.kind==='official-filings'?v.records:[]),electionFields:curated.flatMap(v=>v.kind==='ballot-navigation'?v.records:[]),
    candidateProfiles:(profiles.find(r=>r.record_class==='CANDIDATE_PROFILE')?.value as HeldPlaceFamilies['candidateProfiles'])??null,
    candidatePublications:(profiles.find(r=>r.record_class==='CANDIDATE_PUBLICATION')?.value as {documents?:HeldPlaceFamilies['candidatePublications']}|undefined)?.documents??[],
    derivedCampaignSites:(profiles.find(r=>r.scope===stateBallotScope('candidate-campaign-sites-derived',state))?.value as {records?:HeldPlaceFamilies['derivedCampaignSites']}|undefined)?.records??[]};
  const partitions=MEETING_PARTITION_CONTRACTS.filter(p=>bodies.includes(p.bodyId) || p.ocdId!==null && ids.includes(p.ocdId));
  const outcomes=ROUTINE_SOURCE_CONTRACTS.filter(c=>c.recordClass==='MEETING_OUTCOME' && c.schedule?.follows?.some(p=>bodies.includes(p.bodyId) || partitions.some(known=>known.bodyId===p.bodyId))).map(c=>c.scope);
  const batch=async(statements:readonly {text:string;params:readonly unknown[]}[])=>Promise.all(statements.map(s=>query(s.text,s.params)));
  const [meetings,outcomeReads]=await Promise.all([readPlacePointerSlices<MeetingsSnapshot>('MEETING',partitions.map(p=>p.scope),ids,bodies,targets,batch),readPlacePointerSlices<OutcomeSnapshot>('MEETING_OUTCOME',outcomes,ids,bodies,targets,batch)]);
  const projectionIds=nativeScope?[...new Set([...ids,...registry.registry.bodies.flatMap(body=>body.ocdId??[])])]:ids;
  const capture=projectHeldPlaceCapture(projectionIds,{kind:'PROMOTED',value:registry,metadata:{recordClass:'REGISTRY_RUNTIME_BINDING',scope,versionId:reg?String(reg.current_version_id):null}},meetings,now,families,outcomeReads);
  const checklist={name:'GOV-02',homepage:'GOV-08',office_address:'GOV-08',office_phone:'GOV-08',meeting_cadence:'MTG-04',agenda_url:'MTG-01','comment:attend':'PAR-01','comment:detail':'PAR-02','comment:time_limit':'PAR-03'};
  const fields=bodyRows.map(r=>({subjectId:['meeting_cadence','agenda_url'].includes(String(r.field))?`${r.entity_id}#calendar`:String(r.entity_id),checklistId:checklist[r.field as keyof typeof checklist],value:r.value,state:'published' as const,sourceUrl:String(r.url),checkedAt:new Date(r.checked_at as string).toISOString(),freshUntil:new Date(Date.parse(String(r.checked_at))+FRESHNESS_HOURS.registryRecord*3600000).toISOString()}));
  const memberBody=new Map(registry.bodyRosters.flatMap(r=>r.members.map(m=>[m.id,r.bodyId] as const)));
  return {subjects:nativeScope?capture.subjects.filter(subject=>subject.kind!=='division').map(subject=>({...subject,divisionIds:requestedIds})):capture.subjects,held:[...capture.held.map(f=>f.checklistId==='OFF-04' && memberBody.has(f.subjectId) && f.value && typeof f.value==='object' ? {...f,value:{...f.value,bodyId:memberBody.get(f.subjectId)}}:f),...fields]};
}
