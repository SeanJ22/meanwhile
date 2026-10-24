import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";
import {primeBallotFundingRead} from "../lib/ballot/reader-data.ts";
import {readPromotedCivicData} from "../lib/civic-data/read-model.ts";
import {requiredRoutineContract} from "../lib/civic-data/contracts.ts";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import type {BallotSet,Contest} from "../lib/ballot/types.ts";
import {readFederalDirectoryProjection} from "../lib/officials/federal-directory-read-model.ts";
import {federalDirectoryScope,type FederalDirectoryReadModel} from "../lib/officials/federal-directory-data-plane.ts";
import type {Officeholder} from "../lib/officials/types.ts";
import {provenEdgeEntry} from "./helpers/promoted-edge-entry.ts";
import {readFundingSnapshot} from "../lib/funding/snapshot.ts";
import {fundingAnswerForTarget} from "../lib/funding/display.ts";
import type {FundingCandidate,FundingSnapshot} from "../lib/funding/types.ts";

const AT="2026-10-19T12:00:00.000Z";

async function directoryRead(state:string, officeholders:Officeholder[]=[], divisions:FederalDirectoryReadModel["roster"]["divisions"]=[]) {
  const sha="0".repeat(40);
  const value:FederalDirectoryReadModel={formatVersion:1,sourceSha:sha,currentMembershipComplete:true,
    roster:{scope:`US-${state}`,generatedAt:AT,officeholders,divisions,unmatched:[]},
    directory:{source:{project:"Reader SQL fixture",repoUrl:"https://example.gov",sha,licence:"Public domain",
      licenceUrl:"https://example.gov",sourceOrg:"Reader SQL fixture",collectedAt:AT},counts:{},committees:{},
      byMember:Object.fromEntries(officeholders.map(holder=>[holder.id.slice("congress:".length),{districtOffices:[],committees:[]}]))}};
  return readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY",federalDirectoryScope(state),{edge:provenEdgeEntry({
    recordClass:"FEDERAL_DIRECTORY",scope:federalDirectoryScope(state),sourceId:"congress-directory-project",
    versionId:`test:ballot-money-directory:${state}`,value,retrievedAt:AT})});
}

test("partitioned federal ballot money keeps full selected filings and committee books without following a shared donor into another candidate",async()=>{
  const {pg,publish}=await migratedReaderDb(),contract=requiredRoutineContract("fec-funding");
  const contest={id:"ballot-nj-federal",ocdId:"ocd-division/country:us/state:nj/cd:11"}as Contest;
  const set={election:{state:"NJ"},candidacies:[{id:"ballot-nj-current",contestId:contest.id,givenName:"Current",familyName:"Fixture"},
    {id:"ballot-nj-missing",contestId:contest.id,givenName:"Missing",familyName:"Fixture"}],
    filingCandidacies:[{id:"ballot-nj-earlier",contestId:contest.id,givenName:"Earlier",familyName:"Fixture"},
      {id:"elsewhere",contestId:"another-contest",givenName:"Elsewhere",familyName:"Fixture"}]}as BallotSet;
  const receipt={contributorCommitteeId:"C_SHARED",amount:500,sourceUrl:"https://www.fec.gov/data/receipt/held"};
  const candidates=[{fecCandidateId:"H0NJ00001",targetKeys:["ballot-nj-current","congress:A000001"],cycle:2026,
    totals:{receipts:12345,coverageEndDate:"2026-09-30"},topContributions:[receipt],detail:"complete-source-detail".repeat(2000)},
    {fecCandidateId:"H0NJ00002",targetKeys:["ballot-nj-earlier"],cycle:2024,totals:{receipts:6789},topContributions:[{...receipt,contributorCommitteeId:"C_OLD"}]},
    {fecCandidateId:"H0NJ00003",targetKeys:["elsewhere"],cycle:2026,totals:{receipts:9000},topContributions:[receipt]}];
  const secondHop=[{committeeId:"C_SHARED",cycle:2026,topContributions:[{amount:1000,name:"Complete committee receipt"}]},
    {committeeId:"C_OLD",cycle:2024,topContributions:[{amount:2000,name:"Earlier committee receipt"}]},
    {committeeId:"C_UNRELATED",cycle:2026,topContributions:[]}];
  const absences=[{targetKey:"ballot-nj-missing",reason:"Held source absence"},{targetKey:"elsewhere",reason:"Other candidate"}];
  const payload={formatVersion:1,fetchedAt:AT,cycle:2026,candidates,secondHop,absences,matchReport:{rosterMatched:3},refreshAttempts:{source:AT}};
  const encoded=partitionCivicPayload(payload);assert.ok(encoded.parts.length);
  let reads=0;const previousUrl=process.env.DATABASE_URL;
  process.env.DATABASE_URL="postgres://readonly:fixture@127.0.0.1/reader-migrations-test";
  installReaderDatabaseQuery(async statements=>{
    reads++;const statement=statements[0];
    assert.equal(statements.length,1);assert.equal(statement.params.length,3,"a ballot slice has no geographic expansion");
    return[(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows];
  });
  try{
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts(hash,payload) VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await publish({id:"ballot-fec-slice",sourceId:contract.sourceId,recordClass:"FEC_FUNDING",scope:contract.scope,at:AT,value:encoded.value});
    const selection={states:["NJ"],keys:new Set([contest.ocdId,"state:NJ","07005"])};
    await withReaderSelection(selection,async()=>{
      await readFederalDirectoryProjection(["NJ"],{},()=>directoryRead("NJ"));
      await primeBallotFundingRead(set,[contest]);
      selection.keys.add("congress:A000001");
      const result=await readPromotedCivicData<typeof payload>("FEC_FUNDING",contract.scope);
      assert.equal(result.kind,"PROMOTED",JSON.stringify(result));
      if(result.kind==="PROMOTED"){
        assert.deepEqual(result.value,{...payload,candidates:candidates.slice(0,2),secondHop:secondHop.slice(0,2),absences:absences.slice(0,1)});
        assert.equal(result.metadata.sourceThrough,"2026-10-19");
      }
      assert.equal(reads,1,"later card aliases reuse the same complete selected holding");
    });
  }finally{installReaderDatabaseQuery(undefined);if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;await pg.close();}
});

test("a cold Virginia ballot selects its held FEC registration after the concurrent official read, with unknown amounts intact",async()=>{
  const {pg,publish}=await migratedReaderDb(),contract=requiredRoutineContract("fec-funding");
  const filing={sourceOrg:"Virginia Department of Elections",sourceUrl:"https://www.elections.virginia.gov/casting-a-ballot/candidate-list/",
    collectedAt:AT,verifiedAt:AT};
  const contest:Contest={id:"va-sbe-2026-us-house-10",ocdId:"ocd-division/country:us/state:va/cd:10",
    title:"Member, House of Representatives — 10th District",electionId:"va-2026-11-03-general",divisionVintage:"2026",
    type:"CANDIDACY",voteFor:1,termYears:2,scopeNote:null,provenance:filing};
  const set:BallotSet={election:{state:"VA",id:contest.electionId,date:"2026-11-03",name:"2026 General Election"},
    contests:[contest],candidacies:[{id:"va-sbe-2026-us-house-10:suhas-subramanyam:democratic",contestId:contest.id,
      givenName:"Suhas",familyName:"Subramanyam",partyLabel:"Democratic",slogan:null,incumbent:true,
      websiteUrl:"https://www.suhasforvirginia.com",provenance:filing}],filingCandidacies:[],measures:[],absences:[]};
  const holder:Officeholder={id:"congress:S001230",personId:"congress:S001230",nativeIds:{bioguide:["S001230"],fec:["H4VA10279"]},
    name:"Suhas Subramanyam",officeTitle:"U.S. Representative",level:"FEDERAL",state:"VA",chamber:"house",
    termStart:"2025-01-03",termEnd:"2027-01-03",birthDate:null,partyLabel:null,websiteUrl:"https://subramanyam.house.gov",
    contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,
    provenance:{sourceUrl:"https://api.congress.gov/v3/member/S001230?format=json",sourceOrg:"Library of Congress",collectedAt:AT,verifiedAt:AT}};
  // These are the observed target bindings and registration-only fields on the
  // production FEC pointer cv-5ebb867fb8b5281fa6b785a1276734a0 (2026-10-24).
  const registered:FundingCandidate={dataClass:"FEC_COMMITTEE",fecCandidateId:"H4VA10279",name:"SUBRAMANYAM, SUHAS",cycle:2026,
    state:"VA",office:"H",district:"10",targetKeys:["fec:H4VA10279","congress:S001230"],matchRoutes:["native-source-id"],
    principalCommitteeId:null,principalCommitteeIds:[],topContributions:[],
    registration:{label:"registered with the FEC for House VA-10",electionYear:2026,collectedAt:"2026-10-23T01:55:13.737Z"},
    totals:{receipts:null,disbursements:null,cashOnHand:null,individualItemized:null,individualUnitemized:null,
      smallDonorShare:null,coverageEndDate:null},
    provenance:{sourceOrg:"Federal Election Commission",sourceUrl:"https://www.fec.gov/data/candidate/H4VA10279/?cycle=2026",
      collectedAt:"2026-10-23T01:55:13.737Z",verifiedAt:"2026-10-23T01:55:13.737Z"}};
  const unrelated:FundingCandidate={...registered,fecCandidateId:"H0VA05999",name:"UNRELATED SOURCE FIXTURE",district:"05",
    targetKeys:["congress:A000005","fec:H0VA05999"]};
  const payload:FundingSnapshot={formatVersion:1,cycle:2026,fetchedAt:AT,matchReport:{rosterMatched:2,rosterTotal:2,ballotMatched:0,ballotTotal:1},
    candidates:[registered,unrelated],absences:[]};
  const previousUrl=process.env.DATABASE_URL;
  process.env.DATABASE_URL="postgres://readonly:fixture@127.0.0.1/reader-migrations-test";
  let fecReads=0;
  installReaderDatabaseQuery(async statements=>{
    const statement=statements[0];assert.equal(statements.length,1);
    assert.equal(statement.params[0],"FEC_FUNDING");fecReads++;
    assert.ok((statement.params[2]as string[]).includes("congress:S001230"),"the official key reaches the selected SQL before the FEC slice is pinned");
    assert.ok((statement.params[2]as string[]).includes("fec:H4VA10279"),"the source-native FEC alias is selected too");
    return[(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows];
  });
  try{
    await publish({id:"virginia-registration-only",sourceId:contract.sourceId,recordClass:"FEC_FUNDING",scope:contract.scope,at:AT,value:payload});
    const selection={states:["VA"],keys:new Set([contest.ocdId,"20175"])};
    await withReaderSelection(selection,async()=>{
      let finishDirectory!:()=>void;
      const pendingDirectory=new Promise<void>(resolve=>{finishDirectory=resolve;});
      const directory=readFederalDirectoryProjection(["VA"],{},async()=>{
        await pendingDirectory;
        return directoryRead("VA",[holder],[{ocdId:contest.ocdId,officeholderId:holder.id,bodyId:null}]);
      });
      const money=primeBallotFundingRead(set,[contest]);
      await new Promise<void>(resolve=>setImmediate(resolve));
      assert.equal(fecReads,0,"the concurrent official read settles before selecting the FEC records");
      finishDirectory();
      await Promise.all([directory,money]);
      const read=await readFundingSnapshot();
      assert.equal(read.kind,"PROMOTED");
      if(read.kind==="PROMOTED")assert.deepEqual(read.value.candidates,[registered],"another district's filing stays outside the selected holding");
      const answer=fundingAnswerForTarget(holder.id);
      assert.equal(answer.kind,"funding");
      if(answer.kind==="funding"){
        assert.equal(answer.data.registrationLabel,registered.registration!.label);
        assert.equal(answer.data.sourceUrl,registered.provenance.sourceUrl);
        assert.deepEqual(answer.data.sentences,[]);
        assert.deepEqual(answer.data.totals,registered.totals,"an unknown amount never becomes zero");
        assert.deepEqual(answer.data.contributors,[]);
        assert.equal(answer.data.detailSource,undefined,"no unfetched committee is invented");
      }
      assert.equal(fecReads,1,"the candidate card reuses the complete selected holding");
    });
  }finally{installReaderDatabaseQuery(undefined);if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;await pg.close();}
});
