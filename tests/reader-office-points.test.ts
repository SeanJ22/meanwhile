import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { POST } from "../app/api/geocode/route.ts";
import { publishDirectoryOfficePoints, publishRosterOfficePoints } from "../lib/officials/office-points-publication.ts";
import { stateMemberDirectories } from "../lib/reader/member-directories.ts";
import { directoryOffices } from "../lib/map/office-pins.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { DirectoryOffice } from "../lib/officials/directory.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";

const at = "2026-10-23T12:00:00.000Z";
const holder: Officeholder = { id: "plural:az:one", name: "Public Representative", officeTitle: "State Representative", state: "AZ", level: "STATE",
  termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null, phone: null, email: null, campaignUrl: null, photo: null,
  provenance: { sourceUrl: "https://legislature.example.gov/contact", sourceOrg: "Official legislature", collectedAt: at, verifiedAt: at },
  offices: ["100 Main Street, Tucson, AZ 85701", "P.O. Box 25, Tucson, AZ 85701"].map(address => ({
    name: "district", address, sourceUrl: "https://legislature.example.gov/contact", collectedAt: at,
  })) };
const roster: OfficeholderSet = { scope: "US-AZ", generatedAt: at, officeholders: [holder], divisions: [], unmatched: [] };

test("published office points reach the reader directory and map; tomorrow reuses them without a lookup", async () => {
  const calls: string[] = [];
  const first = await publishRosterOfficePoints(roster, null, async address => { calls.push(address); return { lat: 32, lng: -110 }; });
  assert.deepEqual(calls, ["100 Main Street, Tucson, AZ 85701"]);
  const saved = JSON.parse(JSON.stringify(first)) as OfficeholderSet;
  const merged = mergePeopleSets([saved, roster])!;
  assert.equal(merged.officeholders[0].offices!.length, 2, "a fresh source without coordinates does not duplicate the saved office");
  const tomorrow = await publishRosterOfficePoints({ ...roster, generatedAt: "2026-10-24T12:00:00.000Z" }, saved, async () => {
    assert.fail("the next scheduled publication must reuse the saved point");
  });
  const [entry] = stateMemberDirectories(tomorrow);
  const offices = directoryOffices({ holder: { ...holder, social: undefined, sourceUrl: holder.provenance.sourceUrl, photoUrl: null }, tier: "state", role: "State office", seatLabel: null }, entry.directory);
  assert.deepEqual(offices[0].point, { lat: 32, lng: -110 });
  assert.equal(offices[1].point, undefined, "postal boxes remain contacts without a guessed map pin");
  assert.match(tomorrow.officeholders[0].offices![0].geocodedPoint!.sourceUrl, /census.gov/);
  const moved = await publishRosterOfficePoints({ ...roster, officeholders: [{ ...holder, offices: [{ ...holder.offices![0], address: "200 Main Street, Tucson, AZ 85701" }] }] }, saved,
    async address => { calls.push(address); return { lat: 33, lng: -111 }; });
  assert.equal(calls.length, 2);
  assert.equal(moved.officeholders[0].offices![0].geocodedPoint!.lat, 33, "a moved office cannot inherit the old address's point");
});

test("directory publication keeps publisher coordinates, saves missing points once and retries only missing points", async () => {
  const offices: DirectoryOffice[] = [
    { address: "100 Main Street", city: "Tucson", state: "AZ", zip: "85701", phone: null, lat: null, lng: null },
    { address: "200 Main Street", city: "Tucson", state: "AZ", zip: "85701", phone: null, lat: 32, lng: -110 },
    { address: "P.O. Box 25", city: "Tucson", state: "AZ", zip: "85701", phone: null, lat: null, lng: null },
    { address: null, city: "Tucson", state: "AZ", zip: "85701", phone: null, lat: null, lng: null },
  ];
  let calls = 0;
  const saved = await publishDirectoryOfficePoints(offices, [], async () => { calls++; return { lat: 31, lng: -109 }; });
  assert.equal(calls, 1);
  assert.equal(saved[0].lat, null, "a computed point does not masquerade as publisher coordinates");
  assert.equal(saved[0].geocodedPoint!.lat, 31);
  assert.equal(saved[1].lat, 32);
  assert.equal(saved[1].geocodedPoint, undefined);
  assert.deepEqual(await publishDirectoryOfficePoints(offices, saved, async () => { assert.fail("saved points survive another publication"); }), saved);
});

test("the meetings route and representative pins do not geocode reader visits", () => {
  for (const path of ["app/api/meetings/route.ts", "hooks/use-office-pins.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /publicOfficePoints|officePointFor|api\/geocode/);
  }
});

test("a canceled stateless geocode stops its upstream read and retains the private no-store response",async context=>{
  let upstream:AbortSignal|undefined;
  context.mock.method(globalThis,"fetch",async(_input:unknown,init:RequestInit)=>{
    upstream=init.signal!;
    return new Promise((_resolve,reject)=>upstream!.addEventListener("abort",()=>reject(new Error("Canceled")),{once:true}));
  });
  const controller=new AbortController();
  const result=POST(new Request("http://localhost/api/geocode",{method:"POST",body:JSON.stringify({address:"123 Example Street"}),signal:controller.signal}));
  for(let n=0;n<20&&!upstream;n++)await Promise.resolve();
  assert.ok(upstream);controller.abort();
  const response=await result;assert.equal(upstream.aborted,true);
  assert.deepEqual(await response.json(),{match:false});assert.match(response.headers.get("cache-control")!,/no-store/);
});
