import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readerZipStarts } from "../lib/geo/reader-zip-start.ts";
import { lookupIn } from "../lib/geo/zcta-core.ts";

test("every projected ZIP retains the exact held coordinate and postal metadata, including aliases and unplaced ZIPs", () => {
  const centroids=JSON.parse(readFileSync("lib/geo/zcta-centroids.json","utf8")).centroids;
  const postal=JSON.parse(readFileSync("lib/geo/postal-zips.json","utf8")).zips;
  const shards=readerZipStarts(centroids,postal);
  assert.equal(shards.length,100);
  for(const zip of new Set([...Object.keys(centroids),...Object.keys(postal)]))assert.deepEqual(shards[Number(zip.slice(0,2))].locations[zip]??null,lookupIn(centroids,zip,postal),zip);
  for(let index=0;index<shards.length;index++)assert.ok(Object.keys(shards[index].locations).every(zip=>zip.startsWith(String(index).padStart(2,"0"))));
});
