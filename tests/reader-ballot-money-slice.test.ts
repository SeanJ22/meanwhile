import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {withReaderSelection} from "../lib/db/reader-route.ts";
import {primeBallotStateMoneyRead} from "../lib/ballot/reader-data.ts";
import {readPromotedCivicData} from "../lib/civic-data/read-model.ts";
import type {BallotSet,Contest} from "../lib/ballot/types.ts";

const AT="2026-10-19T12:00:00.000Z";
test("the migrated ballot money read retains complete displayed and prior filings without selecting every record in the state",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const division="ocd-division/country:us/state:nj",contest={id:"ballot-nj-local",ocdId:division} as Contest;
  const set={election:{state:"NJ"},candidacies:[{id:"ballot-nj-current",contestId:contest.id},{id:"ballot-nj-unrelated",contestId:"another-contest"}],
    filingCandidacies:[{id:"ballot-nj-earlier",contestId:contest.id}]} as BallotSet;
  const records=[{targetKeys:["ballot-nj-current"],ocdId:division,filings:[{year:2026,sourceUrl:"https://www.elec.nj.gov/current",amount:1234}],notes:{keep:"Full source detail"}},
    {targetKeys:["ballot-nj-earlier"],ocdId:division,filings:[{year:2024,sourceUrl:"https://www.elec.nj.gov/earlier",amount:5678}]},
    {targetKeys:["ballot-nj-unrelated"],ocdId:division,filings:[{year:2026,amount:91011}]}];
  const payload={formatVersion:1,cycle:2026,collectedAt:AT,records,refreshAttempts:{held:{checkedAt:AT}},acquisitionCursors:{next:40}};
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
      assert.equal(result.kind,"PROMOTED");
      if(result.kind==="PROMOTED")assert.deepEqual(result.value,{...payload,records:records.slice(0,2)});
      assert.equal(reads,1,"subsequent money cards consume the same selected holding");
    });
  }finally{installReaderDatabaseQuery(undefined);await pg.close();}
});
