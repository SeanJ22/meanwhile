import assert from "node:assert/strict";
import test from "node:test";
import { publicationCacheScope } from "../lib/civic-data/publication-cache-scope.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

test("publication invalidates removed places from owned deltas and prior metadata without fetching the old model",()=>{
  const candidate={recordClass:"CURATED_READER_RECORD",scope:"unlocated-shared-shelf",readModel:{records:[{state:"AZ"}]},
    changeSet:{changed:[{before:{state:"NH"}}],removed:[{before:{divisionId:"ocd-division/country:us/state:ca"}}]}} as unknown as RoutineCandidate;
  assert.deepEqual(publicationCacheScope(candidate,{states:["TX"],places:["zip:01001"],entities:["body:prior"]}),
    {states:["AZ","CA","NH","TX"],places:["zip:01001"],entities:["body:prior"]});
});
