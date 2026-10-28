import assert from "node:assert/strict";
import test from "node:test";
import {migratedReaderDb} from "./helpers/migrated-reader-db.ts";
import {buildPageBody,storePlacePage} from "../lib/reader/place-builder.ts";
import {readPlacePackage} from "../lib/reader/place.ts";
import {installFactReader} from "../lib/facts/db.ts";
import {GET} from "../app/api/reader/roster/route.ts";
import type {Query} from "../lib/facts/publish.ts";

test("the unopened place carries roster keys; opening a body reads its saved complete roster by key",async()=>{
  const {pg,publish}=await migratedReaderDb();
  const state='ocd-division/country:us/state:az',city=`${state}/place:example`,body=`${city}#council`;
  const at='2026-10-28T12:00:00.000Z',statements:string[]=[];
  const query:Query=async(text,params=[])=>{statements.push(text);return(await pg.query<Record<string,unknown>>(text,[...params])).rows;};
  try{
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1),($3,'body','Council','AZ',$2)",[state,city,body]);
    await publish({id:'runtime',recordClass:'REGISTRY_RUNTIME_BINDING',scope:'US-AZ:reader-registry-runtime',sourceId:'registry',at,
      value:{formatVersion:1,registry:{generatedAt:at,divisions:[{ocdId:city,label:'Example',state:'AZ',divisionType:'place'}],
        bodies:[{id:body,ocdId:city,name:'Council',bodyType:'council',homepage:'https://example.gov'}]},
        bodyRosters:[{bodyId:body,bodyName:'Council',sourceUrl:'https://example.gov/members',sourceOrg:'Council',collectedAt:at,partisanship:'NONPARTISAN',
          members:['Ada Sample','Bea Example','Cam Citizen'].map((name,n)=>({id:`member-${n}`,name,officeTitle:'Council Member',termNote:null,email:null,phone:null,websiteUrl:null}))}],
        rosterReaderDispositions:[],statewideExecutives:[],officialPhotos:{photos:[]},officialCandidacies:{rows:[]},rosterPhotos:{}}});
    await storePlacePage(query,city,await buildPageBody(city,'place','AZ',query));
    await storePlacePage(query,body,await buildPageBody(body,'body','AZ',query));
    const place=await readPlacePackage({state:'AZ',divisionIds:[city]},query);
    assert.ok(place.rosterRefs?.[body]);
    assert.equal(place.registry?.bodyRosters.flatMap(row=>row.members).length,0);
    assert.ok(place.bodies.every(row=>row.roster===null));
    statements.length=0;installFactReader(query);
    const response=await GET(new Request(`https://example.com/api/reader/roster?body=${encodeURIComponent(body)}`));
    assert.equal(response.status,200);
    const roster=await response.json();
    assert.deepEqual(roster.members.map((row:{name:string})=>row.name),['Ada Sample','Bea Example','Cam Citizen']);
    assert.equal(response.headers.get('Netlify-Vary'),'query=body');
    assert.ok(statements.length>0&&statements.every(sql=>!(/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/.test(sql))));
  }finally{installFactReader(undefined);await pg.close();}
});
