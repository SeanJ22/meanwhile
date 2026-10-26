import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {neonConfig} from "@neondatabase/serverless";
import {MemoryRoutineDataStore,type RoutineDataStore} from "../lib/civic-data/store.ts";
import {processRegisteredFanOutCandidate} from "../lib/civic-data/promotion.ts";
import {MemoryEvidenceStore} from "../lib/control-plane/evidence/store.ts";
import {federalMoneyCandidate,federalMoneyCounts} from "../lib/federal-money/candidate.ts";
import {federalMoneyPartitionOf,federalMoneyPartitionScope,federalMoneyLookupKeys,type FederalMoneyPage,type FederalMoneyProjection} from "../lib/federal-money/model.ts";
import {parseFederalMoney} from "../lib/federal-money/parse.ts";
import {writeFederalMoneyPartitions} from "../lib/federal-money/partitions.ts";
import {saveFederalMoneyCapture,withFederalMoneyVault} from "../lib/federal-money/vault.ts";
import {withMigratedRoutineStore} from "./helpers/migrated-routine-store.ts";

const fixture=JSON.parse(readFileSync(new URL("./fixtures/federal-money/openfema-live.json",import.meta.url),"utf8")).DisasterDeclarationsSummaries[0];
async function page(vault:MemoryEvidenceStore,title:string,at:string,ids:readonly string[]=["base-one"]):Promise<FederalMoneyPage> {
  const body=JSON.stringify({DisasterDeclarationsSummaries:ids.map(id=>({...fixture,id,declarationTitle:title}))});
  const capture=await saveFederalMoneyCapture({url:"https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",body,retrievedAt:at,publicationDate:null},vault);
  return {facts:parseFederalMoney("openfema",capture,"AR",body),captures:[capture],complete:true,declaredTotal:ids.length};
}
function candidate(value:FederalMoneyPage,at:string,predecessorVersionId:string|null=null) {
  const projection:FederalMoneyProjection={formatVersion:2,source:"openfema",state:"AR",partition:federalMoneyPartitionOf(value.facts[0]),records:value.facts,
    counts:federalMoneyCounts(value.facts),lookupKeys:federalMoneyLookupKeys(value.facts)};
  return federalMoneyCandidate({projection,page:value,now:at,predecessorVersionId});
}
function blockWholeReads(store:RoutineDataStore) {
  for(const method of ["readPromotion","readCandidate","readCandidateProof","readCandidatePath"] as const)
    Object.assign(store,{[method]:async()=>{throw new Error(`whole federal held read: ${method}`);}});
}

test("changed federal leaves retain native facts through one owned base without whole held reads",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),at="2026-10-26T01:00:00.000Z";
  const first=await page(vault,"Original",at),scope=federalMoneyPartitionScope("openfema","AR",federalMoneyPartitionOf(first.facts[0]));
  await withFederalMoneyVault(vault,()=>writeFederalMoneyPartitions({source:"openfema",state:"AR",store,now:at,page:first,baselines:{}}));
  const original=await store.readPublicationBase("FEDERAL_MONEY",scope);assert.ok(original.current);
  blockWholeReads(store);
  const nextAt="2026-10-26T02:00:00.000Z",incoming=await page(vault,"Added",nextAt,["base-two"]);
  const delta=await withFederalMoneyVault(vault,()=>writeFederalMoneyPartitions({source:"openfema",state:"AR",store,now:nextAt,page:incoming,baselines:{[scope]:federalMoneyCounts(first.facts)}}));
  assert.equal(delta.loaded,1);
  const held=await store.readPublicationBase("FEDERAL_MONEY",scope);
  assert.deepEqual((held.current?.payload as FederalMoneyProjection).records.map(row=>row.id).sort(),[...first.facts,...incoming.facts].map(row=>row.id).sort());
  assert.notEqual(held.current?.versionId,original.current.versionId);
  assert.equal(Object.hasOwn(held.lkg!.candidate,"changeSet"),false);
});

test("a reused federal base still rejects a racing pointer and caller-fabricated ownership",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),at="2026-10-26T01:00:00.000Z";
  const first=candidate(await page(vault,"Original",at),at);
  const published=await withFederalMoneyVault(vault,()=>processRegisteredFanOutCandidate(store,"openfema",first,at));
  assert.ok(published.promoted);
  const base=await store.readPublicationBase("FEDERAL_MONEY",first.scope);
  const nextAt="2026-10-26T02:00:00.000Z",second=candidate(await page(vault,"Current",nextAt),nextAt,published.promoted.versionId);
  const current=await withFederalMoneyVault(vault,()=>processRegisteredFanOutCandidate(store,"openfema",second,nextAt));assert.ok(current.promoted);
  blockWholeReads(store);
  const staleAt="2026-10-26T03:00:00.000Z",stale=candidate(await page(vault,"Stale",staleAt),staleAt,published.promoted.versionId);
  const refused=await withFederalMoneyVault(vault,()=>processRegisteredFanOutCandidate(store,"openfema",stale,staleAt,published.promoted.versionId,{publicationBase:base}));
  assert.equal(refused.promoted,null);assert.equal(refused.candidate.failureCode,"PROMOTION_BASE_CHANGED");
  assert.equal((await store.readPromotionIdentity("FEDERAL_MONEY",first.scope))?.versionId,current.promoted.versionId);
  await assert.rejects(withFederalMoneyVault(vault,()=>processRegisteredFanOutCandidate(store,"openfema",stale,staleAt,undefined,{publicationBase:structuredClone(base)})),/PUBLICATION_BASE_READ_OWNER_MISMATCH/);
});

test("the migrated federal base reads native row revisions and keeps pointer/GOOD coupling",async()=>{
  await withMigratedRoutineStore("openfema",async(store,vault,pg)=>{
    const at=new Date().toISOString(),first=await page(vault,"Original",at,["base-one","base-two"]);
    const scope=federalMoneyPartitionScope("openfema","AR",federalMoneyPartitionOf(first.facts[0]));
    await withFederalMoneyVault(vault,()=>writeFederalMoneyPartitions({source:"openfema",state:"AR",store,now:at,page:first,baselines:{}}));
    blockWholeReads(store);
    const cold=await store.readPublicationBase("FEDERAL_MONEY",scope);assert.ok(cold.current);
    assert.equal((cold.current.payload as FederalMoneyProjection).records.length,2);
    const originalFetch=neonConfig.fetchFunction!,responses:string[]=[],statements:string[]=[];
    neonConfig.fetchFunction=(async(...args:Parameters<typeof originalFetch>)=>{
      const init=args[1] as {body?:string}|undefined;
      if(init?.body){const request=JSON.parse(init.body);for(const query of request.queries??[request])statements.push(query.query);}
      const response=await originalFetch(...args);responses.push(await response.clone().text());return response;
    }) as typeof neonConfig.fetchFunction;
    try {
      const warm=await store.readPublicationBase("FEDERAL_MONEY",scope);assert.equal(warm.current?.versionId,cold.current.versionId);
      assert.equal(statements.some(sql=>sql.includes("reader_payload_value(value) AS value")),false,"unchanged native rows do not cross the connection again");
      const downloaded=responses.join("\n");
      for(const field of ["identities","changeSet","civicRecords"])assert.equal(downloaded.includes(`\\"${field}\\"`),false);
      const target=await store.readFederalMoneyPartitionKeys(scope,[first.facts[0].id]);
      assert.deepEqual(target?.records,[{id:first.facts[0].id,sourceId:first.facts[0].sourceId}]);
      assert.deepEqual(await store.readFederalMoneyPriorPlaces(cold.current.versionId),[]);
    } finally {neonConfig.fetchFunction=originalFetch;}
    await pg.query("UPDATE civic_data_candidates SET normalized_hash=$2 WHERE id=$1",[cold.current.versionId,"0".repeat(64)]);
    await assert.rejects(store.readPublicationBase("FEDERAL_MONEY",scope),/FEDERAL_PUBLICATION_POINTER_PROOF_INVALID/);
  });
});
