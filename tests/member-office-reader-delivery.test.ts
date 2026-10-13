import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../app/api/directory/route.ts";
import { DirectoryRecordsContent } from "../components/officials/member-directory.tsx";
import { loadMemberDirectory } from "../hooks/use-member-directory.ts";
import { officeContactsForMember } from "../lib/ask/office-contacts.ts";
import { contactRecord } from "../lib/ask/contacts.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";

const at="2026-10-01T00:00:00Z",uuid="00000000-0000-4000-8000-000000000011";
const personId=`plural:${uuid}`,id=`plural:oh:${uuid}`,sourceUrl="https://data.openstates.org/people/current/oh.csv";
const person:Officeholder={id,personId,nativeIds:{"ocd-person":[`ocd-person/${uuid}`]},name:"Jane Example",officeTitle:"State Senator",level:"STATE",
  termStart:"",termEnd:"",birthDate:null,partyLabel:null,websiteUrl:null,contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,state:"OH",chamber:"upper",
  provenance:{sourceUrl,sourceOrg:"Open States",collectedAt:at,verifiedAt:null},offices:[
    {name:"district",address:"100 Main St, Columbus, OH 43215",email:"district@example.gov",sourceUrl,collectedAt:at},
    {name:"district",address:"200 Oak St, Columbus, OH 43215",phone:"614-555-0100",email:"east@example.gov",sourceUrl,collectedAt:at},
    {name:"capitol",email:"capitol@example.gov",sourceUrl,collectedAt:at},
  ]};

test("one state shard supplies directory mailto links and distinct sourced Ask office contacts immediately",async()=>{
  const reads:string[]=[];
  await withReaderAuthorityEdge({edgeOnly:true,stateLegislators:{jurisdictions:new Set(["US-OH"]),load:async jurisdiction=>{
    reads.push(jurisdiction);return {versionId:"held-people",value:{formatVersion:1,sourceId:"plural-openstates",jurisdiction:"US-OH",term:"held-release",generatedAt:at,
      roster:{scope:"US-OH",generatedAt:at,officeholders:[person],divisions:[],unmatched:[]}}};
  }}},async()=>{
    const response=await GET(new Request(`https://meanwhile.example/api/directory?member=${encodeURIComponent(personId)}&state=OH`));
    assert.equal(response.status,200);
    const directory=await response.json();
    assert.equal(directory.districtOffices.length,3);
    const markup=renderToStaticMarkup(createElement(DirectoryRecordsContent,{holderId:personId,state:"OH",only:"offices",directory,failed:false}));
    for(const email of ["district@example.gov","east@example.gov","capitol@example.gov"]) assert.ok(markup.includes(`href="mailto:${email}"`));
    const contacts=await officeContactsForMember({id:personId,name:person.name,state:"OH"});
    assert.equal(contacts.length,2,"offices with addresses also supply Ask locations; the email-only office remains on the card");
    assert.equal(new Set(contacts.map(row=>row.id)).size,2,"two district offices cannot overwrite each other's evidence");
    const record=contactRecord(contacts.find(row=>row.email === "district@example.gov")!);
    assert.match(record.text,/100 Main St/);assert.match(record.text,/district@example.gov/);
    assert.equal(record.sourceUrl,sourceUrl);assert.equal(contacts[0].retrievedAt,at);
  });
  assert.deepEqual(reads,["US-OH","US-OH"],"global native identity uses the supplied state; no national roster scan or database read");
});

test("a federal member's existing edge directory also supplies Ask office contacts",async()=>{
  const value=normalizeCongressDirectory({"legislators-current":[{id:{bioguide:"A000001"},name:{first:"Federal",last:"Example"},terms:[{type:"rep",state:"AZ",district:1,start:"2025-01-03",end:"2027-01-03"}]}],
    "legislators-district-offices":[{id:{bioguide:"A000001"},offices:[{address:"100 Main St",city:"Phoenix",state:"AZ",zip:"85001",phone:"602-555-0100"}]}]},"a".repeat(40),at);
  const contacts=await withReaderAuthorityEdge({edgeOnly:true,federalDirectory:{value,versionId:"federal-held"}},()=>officeContactsForMember({id:"congress:A000001",name:"Federal Example",state:"AZ"}));
  assert.equal(contacts.length,1);assert.equal(contacts[0].phone,"602-555-0100");assert.equal(contacts[0].retrievedAt,at);
  assert.match(contacts[0].sourceUrl ?? "",/legislators-district-offices\.yaml$/);
});

test("the shared directory fetch carries and caches the native person's state scope",async()=>{
  const original=globalThis.fetch,urls:string[]=[],key="plural:00000000-0000-4000-8000-000000000012";
  globalThis.fetch=async input=>{urls.push(String(input));return Response.json({districtOffices:[],committees:[]});};
  try {
    const one=loadMemberDirectory(key,"OH"),same=loadMemberDirectory(key,"US-OH"),other=loadMemberDirectory(key,"NC");
    assert.equal(one,same);assert.notEqual(one,other);await Promise.all([one,other]);
    assert.equal(urls.length,2);assert.ok(urls[0].endsWith("&state=OH"));assert.ok(urls[1].endsWith("&state=NC"));
  } finally {globalThis.fetch=original;}
});


test("the committed congress-legislators sample shows held office fields with no missing-field rows", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/ui-01-congress-legislators-hinson.json", import.meta.url), "utf8"));
  const normalized = normalizeCongressDirectory(Object.fromEntries(Object.entries(fixture.yaml as Record<string, string>).map(([key, value]) => [key, parse(value)])), fixture.revision, fixture.retrievedAt);
  const held = normalized.directory.byMember.H001091;
  assert.equal(held.districtOffices.length, 3);
  const markup = renderToStaticMarkup(createElement(DirectoryRecordsContent, { holderId: "congress:H001091", state: "IA", only: "offices", directory: { districtOffices: held.districtOffices, committees: [] }, failed: false }));
  assert.equal((markup.match(/data-directory-office=/g) ?? []).length, 3);
  for (const office of held.districtOffices) {
    assert.ok(markup.includes(office.city!));
    assert.ok(markup.includes(`tel:${office.phone!.replace(/[^\d+]/g, "")}`));
  }
  assert.doesNotMatch(markup, /working on getting|Want us|no published page|<summary[^>]*>Sources/);
  const missing = renderToStaticMarkup(createElement(DirectoryRecordsContent, { holderId: "congress:H001091", state: "IA", only: "offices", directory: { districtOffices: [], committees: [] }, failed: false }));
  assert.equal(missing, "", "the empty directory contributes to the card gap without rendering field rows");
});
