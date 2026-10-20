import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadPublishedAreaLookupState, readPublishedPlaceMemberships, readPublishedZipStates } from "../lib/census-geography/area-lookup.ts";
import type { ReadOnlyQuery, Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";

test("legacy national geography projects source-state facts and only ZIP membership identities for admission", async () => {
  const pg=new PGlite();const transferred:Row[]=[];
  const query:ReadOnlyQuery=async statements=>{const results:Row[][]=[];for(const statement of statements){const rows=(await pg.query<Row>(statement.text,[...statement.params])).rows;transferred.push(...rows);results.push(rows);}return results;};
  const versionMeta={key:"county:2020",type:"county",plan:"2020",zctaTabulation:"2020",effectiveFor:"fixture",provenance:{sourceUrls:["https://census.gov/fixture"],sourceDataset:"CENSUS_TAB20_REL2020",sourceFiles:[],sourceChecksums:[],method:"official source overlaps",computedAt:"2026-10-20"}};
  const group=(state:string,fips:string,geoid:string)=>({geoid,ocdId:`ocd-division/country:us/state:${state.toLowerCase()}/county:example`,label:`${state} county`,stateFips:fips,stateAbbr:state,memberStates:[state],overlaps:[{zcta5:"86515",whole:false,fraction:0.5}]});
  const dataset={formatVersion:1,builtAt:"2026-10-20",coverage:"legacy national",zctaUniverse:["86515"],scopes:[{type:"county",version:"county:2020",versionMeta,fractionBasis:"area",instanceCount:2,zctaEdgeCount:2,
    groupings:[group("AZ","04","04001"),{...group("NH","33","33001"),unrelated:"other-state-evidence".repeat(100_000)}]}]};
  try{
    await pg.exec("CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,payload jsonb);CREATE TABLE civic_data_payload_parts(hash text,payload jsonb)");
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)",[CENSUS_GEO_RECORD_CLASS,CENSUS_GEO_SCOPE,"legacy",JSON.stringify(dataset)]);
    const own=await loadPublishedAreaLookupState(["86515"],query,"AZ");
    assert.equal(own.source,"published");
    const area=await own.lookup.groupingsForZcta("86515");assert.deepEqual(area.memberships.map(row=>row.geography.stateAbbr),["AZ"]);
    assert.equal(transferred.some(row=>row.state_abbr==="NH"),false,"foreign state facts do not cross the connection");
    transferred.length=0;
    assert.deepEqual([...await readPublishedZipStates(["86515"],query)],[["86515",["AZ","NH"]]],"source jobs still preserve every split-ZIP state");
    const identities=await readPublishedPlaceMemberships(["86515"],query);
    assert.deepEqual(identities.map(row=>[row.zip,row.type,row.geoid,row.state,row.zctaTabulation]),[["86515","county","04001","AZ","2020"],["86515","county","33001","NH","2020"]]);
    assert.ok(transferred.every(row=>Object.keys(row).every(key=>["zip","type","geoid","version","state","zcta_tabulation"].includes(key))));
    assert.ok(JSON.stringify(transferred).length<1024,"admission receives a bounded identity projection, including on an old national blob");
  }finally{await pg.close();}
});
