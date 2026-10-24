import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Query } from "../../lib/facts/publish.ts";
import { legacyZipEntry, type LegacyZipShard } from "../../lib/place-map/legacy.ts";
import { contains, type GeoFeature } from "../../lib/registry/resolve.ts";
import { postalArea, zipNeedsAddress } from "../../lib/geo/postal.ts";
import { isTownOrCountyDivision } from "../../lib/geo/postal-core.ts";
import { placesForCode } from "../../lib/place-map/read.ts";
import { placeEntry } from "../../lib/place-map/reader.ts";
import { censusWorkDivision } from "../../lib/census-geography/division-id.ts";
import type { GeographySelection } from "../../lib/census-geography/selection.ts";
import type { CodeSlice, Slice } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { currentReaderAuthorityEdge } from "../../lib/registry/runtime-edge.ts";

const root = join(import.meta.dirname,"../..");
const shapes = JSON.parse(readFileSync(join(root,"public/geo/state-outlines.geojson"),"utf8")).features as GeoFeature[];
const row = (id:string, extra:Record<string,unknown>={}) => {
  const state = /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1].toUpperCase() ?? null;
  const family = /\/(cd|sldu|sldl):/.exec(id)?.[1], layer = family ?? id.split("/").at(-1)!.split(":")[0];
  return {place_id:id,name:id,state,layer,boundary_year:family ? 2024 : 2023,version:family === "cd" ? "cd:119" : `${layer}:${family ? 2024 : 2023}`,
    partial:false,fringe:false,county_attachment:false,host_county_id:null,...extra};
};

/** Acquired seed data supplies rows to the new map interface in isolated reader tests. */
export function fixturePlaceMapQuery(fallback?: Query): Query {
  return async (sql,params=[]) => {
    if (sql.includes("FROM zip_place m") && /m\.zip=\$1/.test(sql)) {
      const zip=String(params[0]), area=postalArea(zip), code=area?.zcta ?? zip;
      const path=join(root,"data/derived/zip-divisions",`${code.slice(0,2)}.json`);
      if(!existsSync(path))return [];
      const shard=JSON.parse(readFileSync(path,"utf8")) as LegacyZipShard, entry=legacyZipEntry(shard,code);
      if(!entry)return [];
      const ids=zipNeedsAddress(zip)?entry.ids.filter(isTownOrCountyDivision):[...entry.ids,...entry.fringe??[]];
      const seedRows=ids.map(id=>row(id,{partial:entry.partial.includes(id)||zipNeedsAddress(zip)&&id.split('/').length>3,fringe:entry.fringe?.includes(id)??false}));
      if(zipNeedsAddress(zip))return seedRows;
      const census=await currentReaderAuthorityEdge()?.censusDistricts?.slice(code);
      const censusRows=census?.kind==='HELD'?census.value.containers.flatMap(container=>{
        const id=censusWorkDivision(container.ref),overlap=container.overlaps?.find(value=>value.zcta5===code);
        return id&&overlap?[row(id,{version:container.ref.version,partial:!overlap.whole,share:overlap.fraction})]:[];
      }):[];
      const replaced=new Set(censusRows.map(value=>`${value.state}/${value.layer}`));
      return [...seedRows.filter(value=>!replaced.has(`${value.state}/${value.layer}`)),...censusRows];
    }
    if (sql.includes("WITH candidates AS MATERIALIZED") && sql.includes("place_boundary")) {
      const point=[Number(params[0]),Number(params[1])] as [number,number];
      const states=shapes.filter(shape=>contains(point,shape));
      const out:Record<string,unknown>[]=states.map(shape=>row(shape.properties.ocdId,{layer:"state",geometry:shape.geometry}));
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
}

export async function entryForCensusFixture(slice:Slice<CodeSlice>,zip:string,selection:GeographySelection){
  const rows=slice.kind==='HELD'?slice.value.containers.flatMap(container=>{
    const id=censusWorkDivision(container.ref),overlap=container.overlaps?.find(value=>value.zcta5===zip);
    if(!id||!overlap)return [];
    return [row(id,{version:container.ref.version,share:overlap.fraction,partial:!overlap.whole})];
  }):[];
  return placeEntry(await placesForCode(async()=>rows,'zip',zip,selection));
}
