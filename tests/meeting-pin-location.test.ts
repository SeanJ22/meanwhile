import assert from "node:assert/strict";
import test from "node:test";
import { meetingPinAddresses } from "../lib/meetings/pin-location.ts";
import { bodyClassFromIdentity } from "../lib/registry/kinds.ts";
import { badgeFor } from "../lib/meetings/jurisdiction-badge.ts";
import { withSittingFacts } from "../lib/facts/meeting-read.ts";
import { groupByVenue } from "../lib/meetings/venues.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { MeetingPinBody } from "../lib/meetings/pin-location.ts";

const source={sourceUrl:"https://example.gov/calendar",sourceOrg:"Government",collectedAt:"2026-10-24T00:00:00Z",verifiedAt:null};
const division="ocd-division/country:us/state:nc/county:wake";
const body={bodyId:`${division}#governing`,name:"Board",officeContact:{address:"1 Board Street, Raleigh, NC 27601",phone:null,provenance:source},
  governmentOffice:{name:"County",address:"2 Government Street, Raleigh, NC 27601",provenance:source}} as MeetingPinBody;
const meeting={id:"existing:meeting:id",bodyId:body.bodyId,bodyName:"Board",location:null,ocdId:division,provenance:source} as Meeting;

test("canonical governing and school board identities count as governing; source kinds retain their class",()=>{
  for(const suffix of ["governing","board"]) assert.equal(badgeFor(meeting,new Set([division]),"ADDRESS",null,bodyClassFromIdentity(`${division}#${suffix}`)),"GOVERNS");
  assert.equal(bodyClassFromIdentity("body:one","executive agency"),"EXECUTIVE_AGENCY");
  assert.equal(bodyClassFromIdentity(`${division}#body:planning-commission`),"COMMISSION");
  assert.equal(bodyClassFromIdentity(`${division}#body:finance-committee`),"ADVISORY");
});

test("published venue, board office, then owning government office retain exact addresses and sources",()=>{
  const facts=[{meetingId:meeting.id,field:"location" as const,value:{name:"Council room",address:"3 Meeting Street, Raleigh, NC 27601"},source}];
  const [first]=withSittingFacts([meeting],facts);
  assert.deepEqual(meetingPinAddresses(first,body).map(p=>[p.basis,p.address]),[["MEETING",facts[0].value.address],["BODY_OFFICE",body.officeContact!.address],["GOVERNMENT_OFFICE",body.governmentOffice!.address]]);
  assert.deepEqual(meetingPinAddresses(meeting,{...body,officeContact:null}).map(p=>p.basis),["GOVERNMENT_OFFICE"]);
  assert.equal(meeting.id,first.id);assert.equal(meeting.location,null);assert.equal(first.fieldSources?.location,source);
  const pins=meetingPinAddresses(first,body).map(p=>({...p,lat:35.78,lng:-78.64}));
  const [venue]=groupByVenue([first],undefined,[pins[0]]);
  assert.equal(venue.pinBasis,"MEETING");assert.equal(venue.meetings[0].id,meeting.id);
});

test("online pins keep join links and missing venues pin at the appropriate office without changing attendance",()=>{
  const online={...meeting,online:{label:"Online only",joinUrl:"https://example.gov/join"}};
  const [address]=meetingPinAddresses(online,body);
  const [venue]=groupByVenue([online],undefined,[{...address,lat:35.78,lng:-78.64}]);
  assert.equal(venue.kind,"ONLINE_ONLY");assert.equal(venue.pinBasis,"BODY_OFFICE");
  assert.equal(venue.meetings[0].online?.joinUrl,online.online.joinUrl);assert.equal(online.location,null);
  assert.equal(groupByVenue([meeting],undefined,[{...address,lat:35.78,lng:-78.64}])[0].pinBasis,"BODY_OFFICE");
});

test("the next ordinary fact read moves a rescheduled location without reusing old coordinates or changing ids",()=>{
  const prior={...meeting,location:{name:"Old room",address:"1 Old Street",lat:35.78,lng:-78.64}};
  const [next]=withSittingFacts([prior],[{meetingId:meeting.id,field:"location",value:{name:"New room",address:"4 New Street, Raleigh, NC 27601"},source}]);
  assert.equal(next.id,prior.id);assert.equal(next.location,null);
  assert.equal(meetingPinAddresses(next,body)[0].address,"4 New Street, Raleigh, NC 27601");
  assert.equal(prior.location.address,"1 Old Street");
  const [renamed]=withSittingFacts([prior],[{meetingId:meeting.id,field:"location",value:{name:"Renamed room",address:"1 Old Street"},source}]);
  assert.equal(renamed.location?.lat,prior.location.lat,"a room rename at the same published address keeps its verified pin");
});
