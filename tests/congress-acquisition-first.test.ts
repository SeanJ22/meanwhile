import assert from "node:assert/strict";
import test from "node:test";
import {normalizeCongressDirectory} from "../lib/officials/congress-normalize.ts";
import {federalDirectoryCandidate,federalDirectoryForState} from "../lib/officials/federal-directory-data-plane.ts";
import {MemoryRoutineDataStore} from "../lib/civic-data/store.ts";
import {MemoryEvidenceStore} from "../lib/control-plane/evidence/store.ts";
import {processRegisteredManualCandidate} from "../lib/civic-data/promotion.ts";
import {readStateFederalDirectory} from "../lib/officials/federal-directory-read-model.ts";
const NOW="2026-10-01T12:00:00.000Z",SHA="a".repeat(40);
const person=(id:string,state:string,terms:unknown[]=[])=>({id:{bioguide:id,fec:["H0AZ01234"]},name:{first:"Jane",last:id},terms:terms.length ? terms : [{type:"rep",start:"2025-01-03",end:"2027-01-03",state,district:0,phone:"202-225-1000"}]});
const raw={"legislators-current":[person("A000001","DC"),person("A000002","PR"),person("A000003","AZ",[{type:"rep",start:"2023-01-03",end:"2025-01-03",state:"AZ",district:1},{type:"sen",start:"2027-01-03",end:"2033-01-03",state:"AZ"}])]};
test("as-of membership excludes expired/future terms and serves native delegate divisions and FEC IDs",()=>{
  const value=normalizeCongressDirectory(raw,SHA,NOW);
  assert.equal(value.roster.officeholders.length,2);
  assert.deepEqual(value.roster.officeholders.map(row=>row.officeTitle),["Delegate to the U.S. House","Resident Commissioner"]);
  assert.deepEqual(value.roster.divisions.map(row=>row.ocdId),["ocd-division/country:us/district:dc/cd:at-large","ocd-division/country:us/territory:pr/cd:at-large"]);
  assert.deepEqual(value.roster.officeholders[0].fecCandidateIds,["H0AZ01234"]);
  assert.equal(value.roster.officeholders[0].personId,"congress:A000001");
});
test("optional missing files retain valid prior facts and source dates",()=>{
  const before=normalizeCongressDirectory({...raw,"legislators-social-media":[{id:{bioguide:"A000001"},social:{twitter:"jane"}}],"legislators-district-offices":[{id:{bioguide:"A000001"},offices:[{city:"Washington",address:"One Main St"}]}]},SHA,NOW);
  const after=normalizeCongressDirectory(raw,"b".repeat(40),"2026-10-02T12:00:00.000Z",before);
  assert.deepEqual(after.roster.officeholders[0].social,{twitter:"jane"});
  assert.equal(after.directory.byMember.A000001.districtOffices.length,1);
  assert.equal(after.roster.officeholders[0].fieldSources?.social.collectedAt,NOW);
});
test("cached membership bytes are evaluated at today's as-of date without renewing their source timestamp",()=>{
  const value=normalizeCongressDirectory(raw,SHA,NOW,null,{},"2027-01-04T00:00:00Z");
  assert.deepEqual(value.roster.officeholders.map(row=>row.id),["congress:A000003"]);
  assert.equal(value.roster.officeholders[0].officeTitle,"U.S. Senator");
  assert.equal(value.roster.officeholders[0].provenance.collectedAt,NOW);
});
test("a malformed optional office array and a nameless core row leave valid source people publishable",()=>{
  const value=normalizeCongressDirectory({...raw,"legislators-current":[...raw["legislators-current"],{...person("A000004","AZ"),name:{}}],
    "legislators-district-offices":[{id:{bioguide:"A000001"},offices:42}]},SHA,NOW);
  assert.equal(value.roster.officeholders.length,2);
  assert.equal(value.currentMembershipComplete,false);
});
test("core-only source promotes each place through its own pointer without optional files or cardinality floors",async()=>{
  const national=normalizeCongressDirectory(raw,SHA,NOW),url=`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  const store=new MemoryRoutineDataStore(),acquisitions=[{requestedUrl:url,finalUrl:url,httpStatus:200,body:JSON.stringify(raw["legislators-current"])}];
  for(const state of ["DC","PR"]){
    const candidate=await federalDirectoryCandidate({state,vault:new MemoryEvidenceStore(),projection:federalDirectoryForState(national,state),retrievedAt:NOW,acquisitions});
    const outcome=await processRegisteredManualCandidate(store,`congress-bulk-roster:${state}` as const,candidate,NOW);
    assert.equal(outcome.candidate.state,"PROMOTED",outcome.candidate.failureDetail ?? "");
  }
  const read=await readStateFederalDirectory("PR",{store,now:NOW,bypassCache:true});
  assert.equal(read.kind,"PROMOTED");
  if(read.kind==="PROMOTED")assert.deepEqual(read.value.roster.officeholders.map(row=>row.officeTitle),["Resident Commissioner"]);
});
test("a place whose every seat is vacant publishes empty only when the whole membership was read",async()=>{
  const national=normalizeCongressDirectory(raw,SHA,NOW),url=`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  const acquisitions=[{requestedUrl:url,finalUrl:url,httpStatus:200,body:JSON.stringify(raw["legislators-current"])}];
  const complete=await federalDirectoryCandidate({state:"GU",vault:new MemoryEvidenceStore(),projection:{...federalDirectoryForState(national,"GU"),currentMembershipComplete:true},retrievedAt:NOW,acquisitions});
  assert.deepEqual(complete.semantics.violations,[]);
  const partial=await federalDirectoryCandidate({state:"GU",vault:new MemoryEvidenceStore(),projection:{...federalDirectoryForState(national,"GU"),currentMembershipComplete:false},retrievedAt:NOW,acquisitions});
  assert.ok(partial.semantics.violations.includes("FEDERAL_ROSTER_EMPTY"));
});
