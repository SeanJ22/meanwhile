import { PLACE_CHECKS_SQL } from "../lib/reader/place-builder.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { registryRuntimeCandidate, type RegistryRuntimeCarton } from "../lib/registry/runtime-data-plane.ts";
import { readHeldBodyIds } from "../lib/meetings/edge-serving.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { PLACE_PAGES_SQL, readPlacePackage } from "../lib/reader/place.ts";
import type { Query } from "../lib/facts/publish.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const AT = "2026-10-25T00:00:00.000Z";
const ROOT = "ocd-division/country:us/state:az", CITY = `${ROOT}/place:example`;
const NEW_BODY = `${CITY}#new-parks-board`, OLD_ALIAS = `${CITY}#prior-council`, FOREIGN_ALIAS = `${CITY}#foreign-alias`;
const SOURCE = "https://example.gov/boards";

test("a later runtime publication gives its new board a queued ready page while preserving held aliases", async t => {
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("The source fixture must stay local");});
  await withMigratedRoutineStore("registry-runtime:AZ", async (store, _vault, pg) => {
    Object.assign((store as unknown as {writeAuthority:{capability:string}}).writeAuthority,{capability:"MANUAL_CONTRACT"});
    const query:Query=async(text,params=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    await query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),
      ($2,'place','Example','AZ',$1),('held-parent','place','Held parent','AZ',$1),
      ('held-council','body','Held verified council name','AZ','held-parent'),
      ('foreign-council','body','Held New Hampshire council','NH',NULL)`,[ROOT,CITY]);
    await query(`INSERT INTO entity_external_id(entity_id,scheme,value)
      VALUES('held-council','body-alias',$1),('foreign-council','body-alias',$2)`,[OLD_ALIAS,FOREIGN_ALIAS]);
    const held=await query("SELECT id,name,state,parent_id FROM entity WHERE kind='body' ORDER BY id");
    const provenance={sourceUrl:SOURCE,sourceOrg:"Fixture government",collectedAt:AT,verifiedAt:AT};
    const payload:RegistryRuntimeCarton={formatVersion:1,registry:{generatedAt:AT,
      divisions:[{ocdId:CITY,divisionType:"place",tier:"local",state:"AZ",label:"Example",parentOcdId:ROOT,
        lsad:null,funcstat:null,classfp:null,geoid:null,canonicalOcdId:CITY,canonicalMatch:"exact",sourceDataset:"DERIVED",provenance}],
      bodies:[{id:NEW_BODY,name:"New Parks Board"},{id:OLD_ALIAS,name:"A current source spelling"},{id:FOREIGN_ALIAS,name:"A foreign source alias"}]
        .map(body=>({...body,ocdId:CITY,bodyClass:"GOVERNING",bodyOrigin:"SOURCED",coverageStatus:"MANUAL",agendaSourceType:"NONE",
          agendaSourceRef:null,meetingCadence:null,homepageUrl:SOURCE,demandCount:0,sourceDataset:"DERIVED",provenance}))},
      bodyRosters:[],rosterReaderDispositions:[],statewideExecutives:[],
      officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[]},officialPhotos:{photos:[]},rosterPhotos:{}};
    const page="Example, Arizona. New Parks Board. A current source spelling. A foreign source alias.";
    const candidate=registryRuntimeCandidate({contractId:"registry-runtime:AZ",version:AT,sourceThrough:AT,payload,
      sourceReceipt:{contractVersion:1,reviewedAt:AT,reviewedBy:"fixture-reviewer",sources:[{requestedUrl:SOURCE,finalUrl:SOURCE,
        publisher:"Fixture government",sourceClass:"OFFICIAL_PUBLISHER",retrievedAt:AT,httpStatus:200,
        rawHash:createHash("sha256").update(page).digest("hex"),reviewedEvidence:page}]}});
    assert.deepEqual(await query("SELECT id FROM entity WHERE id=$1",[NEW_BODY]),[]);
    const published=await processRegisteredManualCandidate(store,"registry-runtime:AZ",candidate,AT,null);
    assert.ok(published.promoted,JSON.stringify(published.candidate.receipt));
    assert.deepEqual(await query("SELECT name,state,parent_id FROM entity WHERE id=$1",[NEW_BODY]),
      [{name:"New Parks Board",state:"AZ",parent_id:CITY}]);
    assert.deepEqual(await query("SELECT id,name,state,parent_id FROM entity WHERE id IN ('held-council','foreign-council') ORDER BY id"),held);
    assert.deepEqual(await query("SELECT id FROM entity WHERE id=ANY($1::text[])",[[OLD_ALIAS,FOREIGN_ALIAS]]),[],"aliases never become duplicate entities");
    assert.equal(await resolveId(OLD_ALIAS,query),"held-council");
    assert.equal(await resolveId(FOREIGN_ALIAS,query),"foreign-council");
    assert.equal(await resolveId(NEW_BODY,query),NEW_BODY);
    assert.ok((await readHeldBodyIds({states:["AZ"],query})).has(NEW_BODY));
    assert.ok((await query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL AND place_id=$1",[NEW_BODY])).length,
      "publication seeds the board before the same state's rebuild request is queued");
    const result=await rebuildPlacePages({db:{transaction:run=>pg.transaction(tx=>run(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))},
      limit:32,concurrency:1,purge:async()=>({purged:true})});
    assert.equal(result.failed,0);
    assert.equal(result.remaining,0);
    let reads=0;
    const read:Query=async(text,params)=>{if(text===PLACE_CHECKS_SQL)return query(text,params);reads++;assert.equal(text,PLACE_PAGES_SQL);return query(text,params);};
    const ready=await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[NEW_BODY]},read);
    assert.deepEqual(ready.bodies.map(body=>body.id),[NEW_BODY]);
    assert.equal(reads,1,"an explicit body visit reads its saved page");
    const alias=await readPlacePackage({state:"AZ",divisionIds:[],bodyIds:[OLD_ALIAS]},read);
    assert.deepEqual(alias.bodies.map(body=>body.id),["held-council"]);
  });
});
