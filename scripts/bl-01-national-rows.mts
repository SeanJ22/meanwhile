/** Read-only replay of every published contest, congressional code and retention row. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PostgresRoutineDataStore} from '../lib/civic-data/store.ts';
import {readPromotedCivicData} from '../lib/civic-data/read-model.ts';
import {REGISTRY_STATES,stateBallotScope,stateBallotContractId} from '../lib/civic-data/state-scopes.ts';
import {manualProjectionCandidate} from '../lib/civic-data/manual-projections.ts';
import {RetentionCard} from '../components/ballot/retention-card.tsx';
import {canonicalCongressionalDivision} from '../lib/ocd/fips.ts';
import {tierForOffice} from '../lib/ocd/tiers.ts';
import type {GenericBallotProjection} from '../lib/ballot/generic-projection.ts';
import type {BuiltDataset} from '../lib/census-geography/dataset.ts';
const variable=process.argv.find(arg=>arg.startsWith('--connection-env='))?.slice(17);
assert.ok(variable && /^BL01_[A-Z_]+$/.test(variable),'Name an isolated-copy connection variable');
const connection=process.env[variable];assert.ok(connection);
assert.notEqual(new URL(connection).hostname.replace('-pooler',''),new URL(process.env.WTP_PRODUCTION_DATABASE_URL_WRITE??'postgres://unused@unused/db').hostname.replace('-pooler',''));
process.env.DATABASE_URL=connection;
process.env.WTP_DB_ROLE='local';
await mkdir('.scratch/bl-01',{recursive:true});
const store=new PostgresRoutineDataStore();const rows=[];
const geography=await store.readPromotion<BuiltDataset>('CENSUS_GEOGRAPHY','US:zcta-geography-overlaps');
const selected=process.argv.find(arg=>arg.startsWith('--state='))?.slice(8);
assert.ok(!selected || REGISTRY_STATES.includes(selected as typeof REGISTRY_STATES[number]));
for(const state of selected?[selected]:REGISTRY_STATES){
 try{
  const read=await readPromotedCivicData<GenericBallotProjection>('BALLOT_CANDIDACY',stateBallotScope('ballot-contests',state),{store,bypassCache:true});
  assert.equal(read.kind,'PROMOTED',`${state}: real promoted ballot read`);if(read.kind!=='PROMOTED')continue;
  const ballots=Object.values(read.value.ballots),contests=ballots.flatMap(b=>b.contests);
  const held=await store.readCandidateProof(read.metadata.versionId!);assert.ok(held?.candidate.retrieval.manualSourceReceipt,`${state}: published candidate lacks its manual source receipt`);
  const candidate=manualProjectionCandidate({contractId:stateBallotContractId('ballot-contests',state),version:held.candidate.temporal.version,sourceThrough:held.candidate.temporal.sourceThrough!,sourceReceipt:held.candidate.retrieval.manualSourceReceipt,payload:read.value});
  const normalized=Object.values((candidate.readModel as GenericBallotProjection).ballots).flatMap(b=>b.contests);
  const cd=normalized.filter(c=>c.ocdId.includes('/cd:'));assert.ok(cd.every(c=>canonicalCongressionalDivision(c.ocdId)===c.ocdId));
  const statewide=contests.filter(c=>/governor|supreme court|public service commission/i.test(c.title));
  for(const c of statewide)assert.equal(tierForOffice(c.title,c.ocdId),'state',state+': '+c.title);
  let rendered=0,wording=0;
  for(const ballot of ballots)for(const contest of ballot.contests.filter(c=>c.type==='RETENTION')){
   const html=renderToStaticMarkup(createElement(RetentionCard,{contest,candidates:ballot.candidacies.filter(c=>c.contestId===contest.id)}));
   assert.match(html,/data-contest-type="RETENTION"/);assert.match(html,/>Yes<\/button>/);assert.match(html,/>No<\/button>/);
   rendered++;if(html.includes('data-retention-question'))wording++;
  }
  const scopeCounts=Object.fromEntries(['cd:120','sldu:2026','sldl:2026'].map(key=>[key,geography?.payload.scopes.find(s=>s.version===key)?.groupings.filter(g=>g.stateAbbr===state).length??0]));
  const row={state,status:'PASS',versionId:read.metadata.versionId,sourceContests:contests.length,sourceRetention:contests.filter(c=>c.type==='RETENTION').length,renderedRetention:rendered,officialWording:wording,wordingGap:rendered-wording,congressionalContests:cd.length,canonicalCongressionalCodes:true,stateTiersChecked:statewide.length,scopeCounts,};
  rows.push(row);console.log(JSON.stringify(row));
 }catch(error){const row={state,status:'FAILED',reason:error instanceof Error?error.message:String(error)};rows.push(row);console.log(JSON.stringify(row));}
 await writeFile(`.scratch/bl-01/${selected?'rows-'+selected:'all-published-rows'}.json`,JSON.stringify(rows,null,2));
}
console.log(JSON.stringify({states:rows.length,failures:rows.filter(r=>r.status!=='PASS'),retention:rows.reduce((n,r)=>n+('renderedRetention' in r?r.renderedRetention:0),0)}));
process.exitCode=rows.some(row=>row.status!=='PASS')?1:0;
