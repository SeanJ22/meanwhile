import assert from 'node:assert/strict';
import test,{after}from'node:test';
import{PGlite}from'@electric-sql/pglite';
import{installPlaceMapQuery,lowestZipByDivision,lowestZipForDivision,lowestZipsForDivisions}from'../lib/place-map/reader.ts';
import type{Query}from'../lib/facts/publish.ts';
const db=new PGlite();after(async()=>{installPlaceMapQuery(undefined);await db.close();});
const state=(s:string)=>`ocd-division/country:us/state:${s}`;
const az=state('az'),nj=state('nj'),town=`${az}/place:town`,school=`${az}/school_district:school`,oldCd=`${az}/cd:old`,newCd=`${az}/cd:new`,foreign=`${state('nv')}/county:neighbor`,tribe='ocd-division/country:us/aiannh:shared';
const selection={purpose:'representation' as const,asOf:'2026-10-28'},next={purpose:'representation' as const,asOf:'2027-01-03'};
async function fixture(){
 await db.exec(`DROP SCHEMA public CASCADE;CREATE SCHEMA public;
  CREATE TABLE entity(id text PRIMARY KEY,name text,state char(2),kind text);
  CREATE TABLE place_boundary(place_id text,boundary_year integer,layer text,version text,county_attachment boolean DEFAULT false,host_county_id text,PRIMARY KEY(place_id,boundary_year));
  CREATE TABLE zip_place(zip text,place_id text,boundary_year integer,share float DEFAULT 1,share_basis text DEFAULT 'unknown',partial boolean DEFAULT false,fringe boolean DEFAULT false,PRIMARY KEY(zip,place_id,boundary_year));
  CREATE TABLE zip_location(zip text,boundary_year integer,lat float,lng float,postal jsonb);
  CREATE TABLE zcta_place(zcta text,place_id text,boundary_year integer,share float,share_basis text,fringe boolean);`);
 const add=async(id:string,s:string,layer:string,year=2026,version='local:2026')=>{
  await db.query('INSERT INTO entity VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,id,s,'place']);
  await db.query('INSERT INTO place_boundary(place_id,boundary_year,layer,version) VALUES($1,$2,$3,$4)',[id,year,layer,version]);
 };
 const member=async(zip:string,id:string,year=2026,fringe=false)=>{await db.query('INSERT INTO zip_place(zip,place_id,boundary_year,fringe) VALUES($1,$2,$3,$4)',[zip,id,year,fringe]);};
 await add(az,'AZ','state');await add(town,'AZ','place',2010,'local:2010');await add(town,'AZ','place');await add(school,'AZ','unsd');
 await add(oldCd,'AZ','cd',2020,'cd:119');await add(newCd,'AZ','cd',2026,'cd:120');await add(foreign,'NV','county');await add(`${az}/county:postal`,'AZ','county');await add(tribe,'NV','aiannh');
 await add(`${nj}/county:one`,'NJ','county');await add(`${nj}/county:fringe`,'NJ','county');
 await member('00001',az);await member('00001',town,2010);await member('00001',town,2026,true);await member('00001',foreign);
 await member('00002',az);await member('00002',town);
 await member('00003',oldCd,2020);await member('00003',newCd);
 await member('00004',oldCd,2020);await member('00004',school,2026,true);
 await member('00005',school);await member('00000',`${az}/county:postal`);await member('00006',tribe);await member('00006',newCd);await member('00007',tribe);await member('00007',town);
 await member('00100',`${nj}/county:one`);await member('00090',`${nj}/county:fringe`,2026,true);
 await db.query('INSERT INTO zip_location VALUES($1,2026,NULL,NULL,$2::jsonb)',['00000',JSON.stringify({type:'po-box',state:'AZ',zcta:'00005'})]);
 const calls:{sql:string;params:readonly unknown[]}[]=[];
 const query:Query=async(sql,params=[])=>{calls.push({sql,params});return(await db.query(sql,[...params])).rows as Record<string,unknown>[];};
 installPlaceMapQuery(query);return{calls};
}
test('keyed witnesses equal the full current map and keep direct, fringe, per-ZIP boundary and crossing-state semantics',async()=>{
 const{calls}=await fixture();const full=await lowestZipByDivision('AZ');calls.length=0;
 const divisions=[town,school,oldCd,newCd,foreign,tribe,`${az}/missing`];
 const keyed=await lowestZipsForDivisions('AZ',divisions,{selection});
 for(const division of divisions)assert.equal(keyed.get(division),full.get(division),division);
 assert.equal(keyed.get(town),'00002','a newer fringe membership supersedes the older own membership in the lower ZIP');assert.equal(keyed.get(school),'00005');assert.equal(keyed.get(oldCd),'00003');assert.equal(keyed.get(newCd),undefined);
 assert.equal(keyed.get(foreign),'00001');assert.equal(keyed.get(tribe),'00007','an unselected legislative plan cannot establish the requested state for a tribal-only ZIP');
 assert.ok(calls.every(call=>!call.sql.includes('SELECT DISTINCT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id WHERE e.state=')),'the state-wide membership enumeration is absent');
 assert.ok(calls.filter(call=>call.sql.includes('AS memberships')).every(call=>!call.sql.includes('e.name')&&!call.sql.includes('m.share')),'only selection columns are read');
 assert.ok(calls.filter(call=>call.sql.includes('AS memberships')).every(call=>!call.sql.includes('postalLink')&&!call.sql.includes('zip_location')),'mail-only borrowed memberships do not supply a witness');
});
test('district plans are selected per candidate ZIP, including a later successor and a ZIP still holding only the continuation',async()=>{
 await fixture();
 assert.equal(await lowestZipForDivision('AZ',oldCd,{selection:next}),'00004');
 assert.equal(await lowestZipForDivision('AZ',newCd,{selection:next}),'00003');
});
test('state fallback is explicit and keeps an exact state row ahead of a lower child ZIP',async()=>{
 await fixture();
 assert.equal(await lowestZipForDivision('AZ',az,{selection,stateFallback:true}),'00001');
 assert.equal(await lowestZipForDivision('NJ',nj,{selection}),null);
 assert.equal(await lowestZipForDivision('NJ',nj,{selection,stateFallback:true}),'00100');
 assert.equal(await lowestZipForDivision('NJ',`${nj}/county:absent`,{selection,stateFallback:true}),null);
});
