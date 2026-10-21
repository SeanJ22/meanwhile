import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";
import {primeBallotStateMoneyRead,primeBallotFundingRead} from "../lib/ballot/reader-data.ts";
import {readPromotedCivicData} from "../lib/civic-data/read-model.ts";
import {requiredRoutineContract} from "../lib/civic-data/contracts.ts";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import type {BallotSet,Contest} from "../lib/ballot/types.ts";

const AT="2026-10-19T12:00:00.000Z";
test("the migrated ballot money read retains complete displayed and prior filings without selecting every record in the state",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const division="ocd-division/country:us/state:nj",contest={id:"ballot-nj-local",ocdId:division} as Contest;
  const set={election:{state:"NJ"},candidacies:[{id:"ballot-nj-current",contestId:contest.id},{id:"ballot-nj-unrelated",contestId:"another-contest"}],
    filingCandidacies:[{id:"ballot-nj-earlier",contestId:contest.id}]} as BallotSet;
  const records=[{targetKeys:["ballot-nj-current"],ocdId:division,filings:[{year:2026,sourceUrl:"https://www.elec.nj.gov/current",amount:1234}],notes:{keep:"Full source detail"}},
    {targetKeys:["ballot-nj-earlier"],ocdId:division,filings:[{year:2024,sourceUrl:"https://www.elec.nj.gov/earlier",amount:5678}]},
    {targetKeys:["ballot-nj-unrelated"],ocdId:division,filings:[{year:2026,amount:91011}],notes:{mentions:"ballot-nj-current"}}];
  const payload={formatVersion:1,cycle:2026,collectedAt:AT,records,refreshAttempts:{held:{checkedAt:AT}},acquisitionCursors:{next:40}};
  const previousUrl=process.env.DATABASE_URL;
  // Select the database reader; every query below runs in the migrated in-memory database.
  process.env.DATABASE_URL="postgres://readonly:fixture@127.0.0.1/reader-migrations-test";
  let reads=0;
  installReaderDatabaseQuery(async statements=>{
    reads++;
    assert.equal(statements.length,1);
    const statement=statements[0];
    assert.deepEqual(statement.params[2],["ballot-nj-current","ballot-nj-earlier"]);
    return [(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows];
  });
  try{
    await publish({id:"ballot-money-slice",sourceId:"nj-elec-campaign-finance",recordClass:"STATE_CAMPAIGN_FINANCE",scope:"US-NJ:campaign-finance:2026",at:AT,value:payload});
    await withReaderSelection({states:["NJ"],keys:new Set([division,"state:NJ","07005"]),point:[-74.4,40.9]},async()=>{
      await primeBallotStateMoneyRead("NJ",set,[contest]);
      const result=await readPromotedCivicData<typeof payload>("STATE_CAMPAIGN_FINANCE","US-NJ:campaign-finance:2026");
      assert.equal(result.kind,"PROMOTED",JSON.stringify(result));
      if(result.kind==="PROMOTED")assert.deepEqual(result.value,{...payload,records:records.slice(0,2)});
      assert.equal(reads,1,"subsequent money cards consume the same selected holding");
    });
  }finally{installReaderDatabaseQuery(undefined);if(previousUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousUrl;await pg.close();}
});

test("partitioned federal ballot money keeps full selected filings and committee books without following a shared donor into another candidate",async()=>{
  const {pg,publish}=await migratedReaderDb(),contract=requiredRoutineContract("fec-funding");
  const contest={id:"ballot-nj-federal",ocdId:"ocd-division/country:us/state:nj/cd:11"}as Contest;
  const set={election:{state:"NJ"},candidacies:[{id:"ballot-nj-current",contestId:contest.id},{id:"ballot-nj-missing",contestId:contest.id}],
    filingCandidacies:[{id:"ballot-nj-earlier",contestId:contest.id},{id:"elsewhere",contestId:"another-contest"}]}as BallotSet;
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
