import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Query } from "../../lib/facts/publish.ts";
import { legacyZipEntry, type LegacyZipShard } from "../../lib/place-map/legacy.ts";
import { contains, type GeoFeature } from "../../lib/registry/resolve.ts";
import { postalAreaNeedsAddress } from "../../lib/geo/postal-core.ts";
import { isTownOrCountyDivision } from "../../lib/geo/postal-core.ts";
import { placesForCode } from "../../lib/place-map/read.ts";
import { placeEntry, placeMapQuery } from "../../lib/place-map/reader.ts";
import { censusWorkDivision } from "../../lib/census-geography/division-id.ts";
import type { GeographySelection } from "../../lib/census-geography/selection.ts";
import type { CodeSlice, Slice } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { currentReaderAuthorityEdge } from "../../lib/registry/runtime-edge.ts";
import { fixturePostalArea as postalArea, fixtureZipRecord } from "./zip-location.ts";
import { parseCensusGeographies, censusGeographiesUrl } from "../../lib/geo/census-geocoder.ts";
import { divisionsFromCensusGeographies, censusVintageFor } from "../../lib/geo/census-geographies.ts";

const root = join(import.meta.dirname,"../..");
const zipNeedsAddress=(zip:string)=>postalAreaNeedsAddress(zip,postalArea(zip));
const shards=new Map<string,LegacyZipShard>();
const shardOf=(prefix:string)=>{
  let held=shards.get(prefix);
  if(!held){const path=join(root,"data/derived/zip-divisions",`${prefix}.json`);if(!existsSync(path))return null;
    held=JSON.parse(readFileSync(path,"utf8")) as LegacyZipShard;shards.set(prefix,held);}
  return held;
};
const heldShapes = new Map<string, GeoFeature[]>();
const shapes = (file:string):GeoFeature[] => {
  let held=heldShapes.get(file);
  if(!held){held=JSON.parse(readFileSync(join(root,file),"utf8")).features as GeoFeature[];heldShapes.set(file,held);}
  return held;
};
const row = (id:string, extra:Record<string,unknown>={}) => {
  const state = /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1].toUpperCase() ?? null;
  const family = /\/(cd|sldu|sldl):/.exec(id)?.[1], layer = family ?? id.split("/").at(-1)!.split(":")[0];
  return {place_id:id,name:id,state,layer,boundary_year:family ? 2024 : 2023,version:family === "cd" ? "cd:119" : `${layer}:${family ? 2024 : 2023}`,
    partial:false,fringe:false,county_attachment:false,host_county_id:null,...extra};
};

export const fixtureCodeRows=(rows:readonly Record<string,unknown>[])=>[{memberships:rows.map(row=>({
  placeId:row.place_id,name:row.name,state:row.state,layer:row.layer,boundaryYear:row.boundary_year,version:row.version,
  share:row.share??null,shareBasis:row.share_basis??"unknown",partial:row.partial??false,fringe:row.fringe??false,
  countyAttachment:row.county_attachment??false,hostCountyId:row.host_county_id??null,
}))}];

async function zipRows(zip:string,postalLinks:boolean):Promise<Record<string,unknown>[]>{
  const area=postalArea(zip), code=area?.zcta ?? zip;
  const answer=(rows:readonly Record<string,unknown>[])=>{
    const states=[...new Set(rows.flatMap(value=>value.state ? [String(value.state)] : []))];
    const roots=states.map(state=>row(`ocd-division/country:us/${state==='DC'?'district':['PR','GU','VI','AS','MP'].includes(state)?'territory':'state'}:${state.toLowerCase()}`,{layer:'state'}));
    return [...roots,...rows];
  };
  const shard=shardOf(code.slice(0,2));
  if(!shard)return answer([]);
  const entry=legacyZipEntry(shard,code);
  if(!entry)return answer([]);
  const held=[...entry.ids,...entry.fringe??[]], flags=(id:string)=>({partial:entry.partial.includes(id),fringe:entry.fringe?.includes(id)??false});
  if(zipNeedsAddress(zip))return answer([
    ...entry.ids.filter(isTownOrCountyDivision).map(id=>row(id,{partial:entry.partial.includes(id)||id.split('/').length>3})),
    ...postalLinks?held.filter(id=>!isTownOrCountyDivision(id)&&!/\/(?:cd|sldu|sldl):/.test(id)).map(id=>row(id,{...flags(id),partial:true})):[]]);
  const seedRows=held.map(id=>row(id,flags(id)));
  const installed=currentReaderAuthorityEdge()?.censusDistricts;
  const census=installed ? await installed.slice(code) : area?.state === "AZ"
    ? (await import("./ballot-district-fixtures.ts")).azDistrictSlice(code) : undefined;
  const censusRows=census?.kind==='HELD'?census.value.containers.flatMap(container=>{
    const id=censusWorkDivision(container.ref),overlap=container.overlaps?.find(value=>value.zcta5===code);
    return id&&overlap?[row(id,{version:container.ref.version,partial:!overlap.whole,share:overlap.fraction})]:[];
  }):[];
  const replaced=new Set(censusRows.map(value=>`${value.state}/${value.layer}`));
  return answer([...seedRows.filter(value=>!replaced.has(`${value.state}/${value.layer}`)),...censusRows]);
}

/** Acquired seed data supplies rows to the new map interface in isolated reader tests. */
export function fixturePlaceMapQuery(fallback?: Query): Query {
  const run:Query=async (sql,params=[]) => {
    if(sql.includes("FROM zip_location")&&!sql.includes("zip_place"))return (params[0] as string[]).flatMap(zip=>{
      const point=fixtureZipRecord(zip);return point?[{...point}]:[];
    });
    if(sql.includes("SELECT DISTINCT m.zip")){
      const state=String(params[0]),manifest=JSON.parse(readFileSync(join(root,"data/derived/zip-divisions/index.json"),"utf8"));
      return (manifest.statesToShards[state]??[]).flatMap((prefix:string)=>Object.keys(shardOf(prefix)!.zips).filter(zip=>{
        const entry=legacyZipEntry(shardOf(prefix)!,zip)!;return entry.ids.some(id=>row(id).state===state);
      }).map((zip:string)=>({zip})));
    }
    if(sql.includes("FROM zip_place m")&&sql.includes("m.zip=ANY(")){
      // Mirrors codeMembershipsSql: a mail-only ZIP's own town and county rows, and with its postal link its ZCTA's
      // other non-legislative places as ones that could govern it.
      const postalLinks=sql.includes("FROM zip_location");
      return (await Promise.all((params[0] as string[]).map(async zip=>[{zip,...fixtureCodeRows(await zipRows(zip,postalLinks))[0]}]))).flat();
    }
    if (sql.includes("WITH candidates AS MATERIALIZED") && sql.includes("place_boundary")) {
      const point=[Number(params[0]),Number(params[1])] as [number,number];
      const states=shapes("public/geo/state-outlines.geojson").filter(shape=>contains(point,shape));
      const out:Record<string,unknown>[]=states.map(shape=>row(shape.properties.ocdId,{layer:"state",geometry:shape.geometry}));
      for(const file of ["public/geo/county-us.geojson","public/geo/cd119.geojson"]){
        for(const feature of shapes(file))if(contains(point,feature))out.push(row(feature.properties.ocdId,{geometry:feature.geometry}));
      }
      for(const state of ["oh","nc","tx"])for(const purpose of ["representation","election"] as const){
        const reply=JSON.parse(readFileSync(join(root,`tests/fixtures/census-address-${state}${purpose==='representation'?'-representation':''}.json`),'utf8'));
        const located=parseCensusGeographies(reply)!;
        if(Math.abs(located.lat-point[1])>.005||Math.abs(located.lng-point[0])>.005)continue;
        const selection={purpose,asOf:"2026-10-24",...(purpose==='election'?{electionDate:"2026-11-03"}:{})};
        for(const division of divisionsFromCensusGeographies(located.geographies!,selection,censusGeographiesUrl("fixture",censusVintageFor(selection)),"2026-10-24")){
          const version=division.divisionType==='cd'?`cd:${purpose==='election'?120:119}`:`${division.divisionType}:2024`;
          out.push(row(division.ocdId,{name:division.label,layer:division.divisionType,version,
            geometry:{type:"Polygon",coordinates:[[[point[0]-.005,point[1]-.005],[point[0]+.005,point[1]-.005],
              [point[0]+.005,point[1]+.005],[point[0]-.005,point[1]+.005],[point[0]-.005,point[1]-.005]]]}}));
        }
      }
      for(const shape of states){
        const state=String(row(shape.properties.ocdId).state).toLowerCase(), dir=join(root,`data/states/${state}/geo`);
        if(!existsSync(dir))continue;
        for(const file of readdirSync(dir).filter(name=>name.endsWith('.geojson')&&!name.includes('body-territories'))){
          const source=JSON.parse(readFileSync(join(dir,file),'utf8')) as {features:GeoFeature[]};
          for(const feature of source.features??[])if(feature.properties.ocdId&&contains(point,feature))out.push(row(feature.properties.ocdId,{geometry:feature.geometry}));
        }
      }
      return out;
    }
    return fallback ? fallback(sql,params) : [];
  };
  return run;
}

export async function entryForCensusFixture(slice:Slice<CodeSlice>,zip:string,selection:GeographySelection){
  const rows=slice.kind==='HELD'?slice.value.containers.flatMap(container=>{
    const id=censusWorkDivision(container.ref),overlap=container.overlaps?.find(value=>value.zcta5===zip);
    if(!id||!overlap)return [];
    return [row(id,{version:container.ref.version,share:overlap.fraction,partial:!overlap.whole})];
  }):[];
  return placeEntry(await placesForCode(async()=>fixtureCodeRows(rows),'zip',zip,selection));
}

/** The whole-state walk that keyed witnesses replaced, kept as their oracle: every ZIP holding one of the state's places, lowest first. */
export async function wholeStateLowestZips(state:string):Promise<ReadonlyMap<string,string>>{
  const out=new Map<string,string>(),code=state.toUpperCase();
  for(const row of await placeMapQuery()(`SELECT m.zip,json_agg(json_build_object('placeId',e.id,'state',e.state,'layer',b.layer,
      'boundaryYear',b.boundary_year,'version',b.version,'fringe',m.fringe) ORDER BY e.id,b.boundary_year) AS memberships
    FROM zip_place m JOIN entity e ON e.id=m.place_id JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year
    WHERE e.kind='place' AND m.zip IN(SELECT own.zip FROM zip_place own JOIN entity p ON p.id=own.place_id WHERE p.state=$1 AND p.kind='place')
    GROUP BY m.zip ORDER BY m.zip`,[code])){
    const result=await placesForCode(async()=>[row],"zip",String(row.zip));
    if(result.states.includes(code))for(const id of placeEntry(result).ids)if(!out.has(id))out.set(id,String(row.zip));
  }
  return out;
}
