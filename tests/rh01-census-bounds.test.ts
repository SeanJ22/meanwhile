import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { readCensusStateDataset } from "../lib/census-geography/state-read.ts";
import { stateContainers, stateContainersStatement, geographyOfRows, censusScopeSelectionStatement, censusAreaSelectionStatement } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { BuiltDataset, BuiltGrouping } from "../lib/census-geography/dataset.ts";
import { acquireDataset } from "../lib/census-geography/acquire.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { buildWorkbook, zip } from "../scripts/xlsx.mjs";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCbsaDelineationFile } from "../lib/census-geography/cbsa.ts";
import { readXlsxFileRows } from "../lib/census-geography/xlsx.ts";

const group=(state:string,geoid:string,zip:string):BuiltGrouping=>({stateFips:geoid.slice(0,2),stateAbbr:state,geoid,ocdId:null,
  label:`${state} retained district`,memberStates:[state],overlaps:[{zcta5:zip,whole:true,fraction:1}]});
const dataset=(groups:BuiltGrouping[]):BuiltDataset=>({formatVersion:1,builtAt:"2026-10-19T12:00:00Z",coverage:"source country",
  zctaUniverse:groups.flatMap(g=>g.overlaps.map(o=>o.zcta5)),scopes:[{type:"congressional_district",version:"cd:119",fractionBasis:"area",groupings:groups,
    instanceCount:groups.length,zctaEdgeCount:groups.length,versionMeta:{key:"cd:119",type:"congressional_district",plan:"119th Congress",
      zctaTabulation:"2020",effectiveFor:"2025-2027",retrievalComplete:true,provenance:{sourceUrls:["https://www2.census.gov/district.txt"],sourceFiles:["district.txt"],sourceChecksums:["sha256"],sourceDataset:"CENSUS_TAB20_REL2020",method:"Official relationship",computedAt:"2026-10-19T12:00:00Z"}}}]});

test("legacy geography parts send only selected state records and new state pointers replace only that state",async()=>{
  const pg=new PGlite(), sent:unknown[]=[];
  let queryError="";
  const query:ReadOnlyQuery=async statements=>{const out=[];for(const statement of statements){let rows;try{rows=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;}catch(error){queryError=String(error);throw error;}sent.push(rows);out.push(rows);}return out;};
  const add=async(scope:string,payload:BuiltDataset,version:string)=>{
    const encoded=partitionCivicPayload(payload);
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,'CENSUS_GEOGRAPHY',$2,$3,$4)",["CENSUS_GEOGRAPHY:"+scope,scope,version,JSON.stringify(encoded.value)]);
  };
  try{
    await pg.exec("CREATE TABLE civic_data_promotions(key text,record_class text,scope text,current_version_id text,payload jsonb);CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
    const own=group("AZ","0407","85701");
    await add("US:zcta-geography-overlaps",dataset([own,...Array.from({length:300},(_,i)=>({...group("NJ",`34${i.toString().padStart(3,"0")}`,"07927"),label:"NJ retained district "+"unrelated records ".repeat(500)}))]),"legacy");
    const held=await readCensusStateDataset("AZ",query);
    assert.deepEqual(held?.scopes[0].groupings,[own]);
    assert.ok(!JSON.stringify(sent).includes("NJ retained"),"another state's records never cross the database connection");
    const slice=await stateContainers("AZ",["congressional_district"],true,query);
    assert.equal(slice.kind,"HELD",queryError);if(slice.kind==="HELD")assert.equal(slice.value.containers[0].overlaps?.[0].zcta5,"85701");
    const statement=stateContainersStatement("AZ");
    const canonical=(await query([statement]))[0][0];
    assert.equal(geographyOfRows(canonical.geography as Record<string,unknown>[],true).containers.length,1);
    const selected=(await query([censusScopeSelectionStatement("AZ",[{type:"zcta",geoid:"85701",stateAbbr:"AZ",version:"zcta:2020"}])]))[0];
    assert.equal(geographyOfRows(selected,true).containers.length,1);
    const area=(await query([censusAreaSelectionStatement(["85701"])]))[0];
    assert.equal(geographyOfRows(area,true).containers.length,1);
    const next=group("AZ","0408","85701");
    await add("US-AZ:zcta-geography-overlaps",dataset([next]),"state-az");
    assert.deepEqual((await readCensusStateDataset("AZ",query))?.scopes[0].groupings,[next]);
    assert.equal((await readCensusStateDataset("NJ",query))?.scopes[0].groupings.length,300);
    const latest=await stateContainers("AZ",["congressional_district"],true,query);
    assert.equal(latest.kind,"HELD");if(latest.kind==="HELD"){assert.equal(latest.versionId,"state-az");assert.equal(latest.value.containers[0].ref.geoid,"0408");}
  }finally{await pg.close();}
});

test("national tab20 input streams through the vault but only the target state enters the accumulator",async()=>{
  const url="https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt";
  const header="GEOID_CD119_20|NAMELSAD_CD119_20|AREALAND_CD119_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n";
  const own="0407|District 7|100|85701|100|100\n";
  const country=Array.from({length:20000},(_,i)=>`34${String(i).padStart(5,"0")}|Other state ${i}|100|07927|100|100\n`).join("");
  const bytes=Buffer.from(header+country+own);
  const built=await acquireDataset({only:["cd119"],states:new Set(["04"]),discoverPlans:false,
    cache:{store:new MemoryEvidenceStore(),locks:createMemoryRepositories().locks},fetchImpl:async input=>{
      assert.equal(String(input),url);return new Response(new ReadableStream({start(controller){for(let at=0;at<bytes.length;at+=8192)controller.enqueue(bytes.subarray(at,at+8192));controller.close();}}));
    }});
  assert.equal(built.scopes[0].groupings.length,1);
  assert.equal(built.scopes[0].groupings[0].geoid,"0407");
  assert.deepEqual(built.zctaUniverse,["85701"]);
});

test("national workbook rows and shared strings stay on disk while only one state's CBSA counties are retained",async()=>{
  const root=await mkdtemp(join(tmpdir(),"rh01-cbsa-"));
  try{
    const path=join(root,"source.xlsx");
    const header=["CBSA Code","CBSA Title","Metropolitan/Micropolitan Statistical Area","FIPS State Code","FIPS County Code"];
    const rows=[["46060","Tucson, AZ","Metropolitan Statistical Area","04","019"],
      ...Array.from({length:2000},(_,i)=>[String(10000+i),`NJ city ${i}`,"Metropolitan Statistical Area","34","001"])];
    await writeFile(path,buildWorkbook([{name:"Delineation",header,rows,widths:[10,30,30,10,10]}],"2026-10-19"));
    const read=await readCbsaDelineationFile(path,new Set(["04"]));
    assert.deepEqual([...read.cbsaByCounty],[["04019","46060"]]);
    assert.equal(read.cbsa.size,1);
    const shared=join(root,"shared.xlsx");
    await writeFile(shared,zip([
      {name:"xl/sharedStrings.xml",data:Buffer.from('<sst><si><t>First &amp; official</t></si><si><t>Second</t></si></sst>')},
      {name:"xl/worksheets/sheet1.xml",data:Buffer.from('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>')},
    ],"2026-10-19"));
    const decoded=[];for await(const row of readXlsxFileRows(shared))decoded.push(row);
    assert.deepEqual(decoded,[["First & official","Second"]]);
  }finally{await rm(root,{recursive:true,force:true});}
});
