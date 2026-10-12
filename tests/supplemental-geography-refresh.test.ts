import assert from "node:assert/strict";
import test from "node:test";
import { acquireDataset } from "../lib/census-geography/acquire.ts";
import type { BuiltScope, GeographySourceFailure } from "../lib/census-geography/dataset.ts";
import { retainFailedSupplementalScopes, readPriorSupplementalScopes } from "../lib/census-geography/supplemental-refresh.ts";
import { CENSUS_AIANNH } from "../lib/census-geography/aiannh.ts";
import { overlaySourceRows } from "../lib/overlay-geography/reference.ts";

const failed = (type: BuiltScope["type"], version: string): GeographySourceFailure => ({type,version,sourceId:"fixture",sourceUrls:["https://publisher.gov/file"],reason:"Source refused"});
function priorScope(type: BuiltScope["type"], version: string): BuiltScope {
  return {type,version,fractionBasis:"area",instanceCount:1,zctaEdgeCount:1,
    versionMeta:{key:version,type,plan:"Previously published plan",zctaTabulation:"2020",effectiveFor:"Representation",
      provenance:{sourceUrls:["https://publisher.gov/file"],sourceDataset:"OFFICIAL",sourceFiles:["file"],sourceChecksums:["old-bytes"],method:"Published source",computedAt:"2025-01-01T00:00:00Z"}},
    groupings:[{geoid:"fixture",ocdId:null,label:"Prior geography",stateFips:"33",stateAbbr:"NH",memberStates:["NH"],overlaps:[{zcta5:"00001",whole:true,fraction:1}]}]};
}

test("a failed source retains its exact prior scope and check date beside unrelated newly built scopes", () => {
  const old = priorScope("overlay_district","overlay:one"), fresh = priorScope("state_leg_lower","sldl:new");
  const result = retainFailedSupplementalScopes([old],[fresh],[failed(old.type,old.version)]);
  assert.ok(result.includes(old));
  assert.ok(result.includes(fresh));
  assert.equal(result.find(row=>row.type === "overlay_district")?.versionMeta.provenance.computedAt,"2025-01-01T00:00:00Z");
  assert.equal(retainFailedSupplementalScopes([],[],[failed(old.type,old.version)]).length,0,"No invented empty scope for an unread source");
});

test("the read of prior supplemental scopes is cut in the store and distinguishes no pointer from store failure", async () => {
  const prior = priorScope("overlay_district","overlay:one");
  const seen:string[]=[];
  const result=await readPriorSupplementalScopes(async statements=>{seen.push(...statements.map(statement=>statement.text));return [[{scopes:[prior]}]]});
  assert.deepEqual(result,[prior]);
  assert.match(seen[0],/s->>'type' IN \('overlay_district','aiannh'\)/);
  assert.deepEqual(await readPriorSupplementalScopes(async()=>[[{scopes:[]}]]),[]);
  assert.equal(await readPriorSupplementalScopes(async()=>{throw Error("Store offline")}),undefined);
});

test("overlay and tribal source failures do not hold back a verified Census scope", async () => {
  const overlay=priorScope("overlay_district",`overlay:${overlaySourceRows[0].id}`), tribal=priorScope("aiannh",CENSUS_AIANNH.version);
  const dataset=await acquireDataset({only:["county","overlays","aiannh"],previousSupplementalScopes:[overlay,tribal],fetchImpl:async input=>{
    if (String(input).includes("tab20_zcta520_county20_natl.txt")) return new Response("GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n33001|Test County|100|00001|100|100\n");
    return new Response("Source unavailable",{status:503});
  }});
  assert.equal(dataset.scopes.find(scope=>scope.type === "county")?.instanceCount,1);
  assert.ok(dataset.scopes.includes(overlay));
  assert.ok(dataset.scopes.includes(tribal));
  assert.equal(dataset.sourceFailures?.length,2);
});
