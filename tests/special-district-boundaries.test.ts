import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { specialDistrictBoundaryPackage, publishSpecialDistrictBoundary, runSpecialDistrictBoundaryPublication } from "../lib/civic-data/special-district-boundaries.ts";
import { specialDistrictsAt, countySpecialDistricts } from "../lib/registry/special-district-boundary.ts";
import { readSpecialDistrictBoundaries, readSpecialDistrictBoundariesForCounties } from "../lib/registry/special-district-boundary-reader.ts";
import { DEFAULT_KINDS } from "../lib/registry/kinds.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
const now = "2026-10-05T23:35:00Z";
const outer = [[-84,40],[-80,40],[-80,44],[-84,44],[-84,40]];
const hole = [[-83,41],[-82,41],[-82,42],[-83,42],[-83,41]];
const saved = (text: string, state: string): WorkerPublicationCapture => ({
  evidence: { artifactId: "saved-gis", acquiredByAttemptId: "fixture", canonicalUrl: `https://gis.${state.toLowerCase()}.gov/districts.geojson`,
    contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, text, retrievedAt: now, sourceId: "official-gis", methodRouteId: "saved-gis" },
  observedAt: now, httpStatus: 200, transport: "REACHABLE", partial: false,
});
test("official district polygons publish on the existing scoped Slide and attach only inside addresses, preserving holes and unknown OCDs", async () => {
  for (const state of ["OH", "MI", "DC", "PR"]) {
    const county = `ocd-division/country:us/${state === "PR" ? "territory:pr" : state === "DC" ? "district:dc" : `state:${state.toLowerCase()}`}/county:alder`;
    const district = { bodyId: `${county}#fire`, countyOcdId: county, districtOcdId: state === "MI" ? null : `${county}/special_district:fire`,
      name: "Alder Fire District", kind: "fire_district", sourceGovernmentId: "001" };
    const door = { doorId: `gis:${state}`, kind: "special-district-boundaries-geojson", ocdId: county, bodyIds: [district.bodyId],
      hosts: [`gis.${state.toLowerCase()}.gov`], config: { fieldMap: JSON.stringify({ governmentId: "Id", governmentName: "Name" }) }, status: "OPEN" } as unknown as DoorRecord;
    const text = JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { Id: "001", Name: district.name }, geometry: { type: "Polygon", coordinates: [outer,hole] } },
      { type: "Feature", properties: { Id: "999", Name: "Unrelated district" }, geometry: { type: "Polygon", coordinates: [outer] } },
    ] });
    const input = { district, door, capture: saved(text,state), kinds: DEFAULT_KINDS, now };
    const built = specialDistrictBoundaryPackage(input), store = new MemoryRoutineDataStore();
    assert.equal(built.payload.records.length,1);
    assert.doesNotMatch(JSON.stringify(built.payload), /Unrelated district/);
    const published = await publishSpecialDistrictBoundary(store,input);
    assert.ok(published.promoted, published.candidate.failureDetail ?? "boundary held");
    assert.equal(published.readerReadback?.status,"PASS");
    const read = await readSpecialDistrictBoundaries(county,{store,now,bypassCache:true});
    assert.equal(read.kind,"PROMOTED");
    if(read.kind !== "PROMOTED") throw new Error("Missing boundary");
    const records = read.value.records;
    assert.deepEqual(records[0].geometry,{type:"Polygon",coordinates:[outer,hole]});
    assert.deepEqual(specialDistrictsAt([-81,43], records).bodyIds,[district.bodyId]);
    assert.deepEqual(specialDistrictsAt([-82.5,41.5],records).bodyIds,[],"hole is outside service area");
    assert.deepEqual(specialDistrictsAt([-85,43],records).bodyIds,[],"same county does not attach an outside address");
    assert.deepEqual(specialDistrictsAt([-81,43],records).ocdIds,district.districtOcdId ? [district.districtOcdId] : [],"no fabricated OCD");
    assert.deepEqual(countySpecialDistricts(county,[{bodyId:"unknown",countyOcdId:county,name:"Boundary owed"}],records)[0],
      {bodyId:"unknown",countyOcdId:county,name:"Boundary owed",serves:"part of the county",boundaryHeld:false});
    await assert.rejects(publishSpecialDistrictBoundary(store,{...input,capture:{...input.capture,partial:true}}));
    await assert.rejects(publishSpecialDistrictBoundary(store,{...input,capture:{...input.capture,httpStatus:206}}));
    const paged = JSON.stringify({...JSON.parse(text),exceededTransferLimit:true});
    await assert.rejects(publishSpecialDistrictBoundary(store,{...input,capture:saved(paged,state)}),/additional unread features/);
    assert.equal((await readSpecialDistrictBoundaries(county,{store,now,bypassCache:true})).kind,"PROMOTED");
    const repos=createMemoryRepositories();
    const item=createWorkItem({project:"fixture",subject:district.bodyId,obligation:"district boundary",why:"Admitted GIS",now});
    const plan={contract:{schemaVersion:2,recordClass:"PUBLIC_RECORD",jurisdiction:{canonicalId:county}},sourceRegistryReferences:[door.doorId],
      publication:{contractId:"special-district-boundaries",bodyId:district.bodyId}} as unknown as NonNullable<WorkItem["autonomousPlan"]>;
    await repos.workItems.put(item.id,{...item,autonomousPlan:plan},now);
    const outcome=await runSpecialDistrictBoundaryPublication({...input,repos,store,workItemId:item.id,workerResultId:"complete-gis"});
    assert.equal(outcome.outcome.status,"PUBLISHED",outcome.outcome.detail);
    assert.deepEqual((await repos.workItems.mustRead(item.id)).value.publicationOutcome,outcome.outcome);
    const held=await runSpecialDistrictBoundaryPublication({...input,capture:{...input.capture,partial:true},repos,store,workItemId:item.id,workerResultId:"partial-gis"});
    assert.equal(held.outcome.status,"HELD");
    await assert.rejects(runSpecialDistrictBoundaryPublication({...input,district:{...district,bodyId:"foreign"},repos,store,workItemId:item.id,workerResultId:"foreign"}),/admitted exact district/);
    const combined={...records[0],geometry:{type:"MultiPolygon" as const,coordinates:[[outer,hole],[outer]]}};
    assert.deepEqual(specialDistrictsAt([-81,43],[combined]).bodyIds,[district.bodyId],"overlapping polygons form a union");
    const invalid=JSON.stringify({type:"FeatureCollection",crs:{properties:{name:"EPSG:3857"}},features:[]});
    assert.throws(()=>specialDistrictBoundaryPackage({...input,capture:saved(invalid,state)}),/coordinate reference/);
    assert.throws(()=>specialDistrictBoundaryPackage({...input,district:{...district,sourceGovernmentId:"missing"}}),/membership remains owed/);
  }
});
test("a complete cold reader edge without optional boundary entries makes zero store reads", async () => {
  await withReaderAuthorityEdge({ promoted: new Map() } as unknown as ReaderAuthorityEdgeBundle, async () => {
    assert.deepEqual(await readSpecialDistrictBoundariesForCounties(["ocd-division/country:us/state:oh/county:alder"]),[]);
  });
});
