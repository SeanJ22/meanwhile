import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {postalRow,postalArea,postalTable} from "../lib/geo/postal.ts";
import {postalAreaIn,type PostalTable} from "../lib/geo/postal-core.ts";
import {lookupZcta,resolveZip} from "../lib/geo/zcta.ts";
import {lookupIn,resolveIn,type CentroidTable} from "../lib/geo/zcta-core.ts";

test("cold postal point reads preserve regional rows, postal aliases and ZIP coordinates before and after enumeration",()=>{
  const table=(JSON.parse(readFileSync("lib/geo/postal-zips.json","utf8")) as {zips:PostalTable}).zips;
  const centroids=(JSON.parse(readFileSync("lib/geo/zcta-centroids.json","utf8")) as {centroids:CentroidTable}).centroids;
  const selected=new Set(["03046","03032","07005","85701","05009","89109","00000"]);
  const prefixes=new Set<string>(),kinds=new Set<string>();
  for(const [zip,row] of Object.entries(table)){
    if(!prefixes.has(zip.slice(0,2))){prefixes.add(zip.slice(0,2));selected.add(zip);}
    if(!kinds.has(String(row[2]))){kinds.add(String(row[2]));selected.add(zip);}
    if(row.some(value=>typeof value==="string"&&/["\\\[\]]/.test(value)))selected.add(zip);
  }
  for(const zip of selected){
    assert.deepEqual(postalRow(zip),table[zip]??null,zip);
    assert.deepEqual(postalArea(zip),postalAreaIn(table,zip),zip);
    assert.deepEqual(lookupZcta(zip),lookupIn(centroids,zip,table),zip);
    assert.deepEqual(resolveZip(zip),resolveIn(centroids,zip,table),zip);
  }
  assert.equal(postalRow("85701 "),null);
  assert.equal(postalRow('85701"'),null);
  assert.deepEqual(postalTable(),table);
  for(const zip of selected)assert.deepEqual(postalRow(zip),table[zip]??null,zip);
});
