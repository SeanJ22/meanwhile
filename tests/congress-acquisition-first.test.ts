import assert from "node:assert/strict";
import test from "node:test";
import {normalizeCongressDirectory} from "../lib/officials/congress-normalize.ts";
import {federalDirectoryCandidate} from "../lib/officials/federal-directory-data-plane.ts";
import {MemoryRoutineDataStore} from "../lib/civic-data/store.ts";
import {processRegisteredManualCandidate} from "../lib/civic-data/promotion.ts";
import {readFederalDirectoryProjection} from "../lib/officials/federal-directory-read-model.ts";
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
test("core-only source promotes through the normal federal pointer without optional files or cardinality floors",async()=>{
  const projection=normalizeCongressDirectory(raw,SHA,NOW),url=`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
  const candidate=federalDirectoryCandidate({projection,retrievedAt:NOW,acquisitions:[{requestedUrl:url,finalUrl:url,httpStatus:200,body:JSON.stringify(raw["legislators-current"])}]});
  const store=new MemoryRoutineDataStore(),outcome=await processRegisteredManualCandidate(store,"congress-bulk-roster",candidate,NOW);
  assert.equal(outcome.candidate.state,"PROMOTED",outcome.candidate.failureDetail ?? "");
  const read=await readFederalDirectoryProjection({store,now:NOW,bypassCache:true});assert.equal(read.kind,"PROMOTED");
});
