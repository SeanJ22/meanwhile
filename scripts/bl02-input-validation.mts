import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {genericBallotProblems} from '../lib/ballot/generic-projection.ts';
const baseline='78f82a232dd1d0545a46835e7716032ff3807425';
const paths=execFileSync('git',['diff','--name-only',baseline,'--','data/ballot/2026-general'],{encoding:'utf8'}).trim().split('\n');
let memberships=0; const states=[];
for(const path of paths){
 const bytes=await readFile(path),state=path.split('/').at(-1)!.slice(0,2).toUpperCase(),input=JSON.parse(bytes.toString());
 assert.deepEqual(genericBallotProblems({kind:"ballot-contests",ballots:input.ballots},state),[],state);
 for(const b of Object.values(input.ballots) as any[]){
  const ids=new Set();
  for(const m of b.districtMemberships??[]){
   assert.ok(!ids.has(m.id),`${state}: duplicate membership`);ids.add(m.id);
   assert.ok(input.sourceReceipt.sources.some((s:any)=>[s.finalUrl,s.requestedUrl].includes(m.provenance.sourceUrl)&&s.retrievedAt===m.provenance.collectedAt),`${state}: ${m.id} source receipt`);
   assert.ok(m.memberOcdId!==m.districtOcdId);memberships++;
  }
 }
 states.push({state,inputSha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile('data/ballot/reports/bl02-input-validation.json',JSON.stringify({step:'BL-02',checkedAt:new Date().toISOString(),stateFiles:states.length,memberships,existingGenericBallotContract:'PASS',uniqueMembershipIds:'PASS',allMembershipCitationsMatchSourceReceipt:'PASS',states},null,2)+'\n');
console.log(JSON.stringify({stateFiles:states.length,memberships,errors:0}));
