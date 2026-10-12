import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TRIBAL_SEAT_REFERENCES, legislativeRepresentationLabel, tribalSeatDescription,
  tribalSeatForMembership, tribalSeatListingsFor, tribalSeatReferencesFor, tribalSeatIsVacant, tribalSeatSources, tribalSeatCardSources } from "../lib/officials/tribal-seats.ts";
import { districtCardSources } from "../lib/officials/card-sources.ts";
import { LegislatureDirectory } from "../components/officials/legislature-directory.tsx";
import { panelSeatsFor, STATE_SEAT_TYPES } from "../lib/state/panel-seats.ts";
import { seatHolderForMembership, type SeatHolder } from "../lib/officials/lookup.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";

function holderFor(reference = TRIBAL_SEAT_REFERENCES[0]): SeatHolder {
  return {id:"test:tribal-holder",name:"Sourced Representative",officeTitle:"State Representative",state:reference.state,chamber:reference.chamber,
    partyLabel:null,termEnd:null,birthDate:null,websiteUrl:null,sourceUrl:reference.officialRosterUrl,
    provenance:{sourceUrl:reference.officialRosterUrl,sourceOrg:reference.sourceOrg ?? "State legislature",collectedAt:"2026-10-12",verifiedAt:null},
    email:null,phone:null,contactFormUrl:null,photoUrl:null,campaignUrl:null,
    memberships:[{id:"test:current-membership",personId:"test:tribal-holder",officeId:`US-${reference.state}:${reference.chamber}:${reference.district}`,
      jurisdiction:`US-${reference.state}`,chamber:reference.chamber,district:reference.district,current:true,sourceUrl:reference.officialRosterUrl}]};
}

test("tribal seats join exact current district memberships and survive without geographic links", () => {
  assert.ok(TRIBAL_SEAT_REFERENCES.length > 0);
  const reference = TRIBAL_SEAT_REFERENCES[0];
  const holder = holderFor(reference);
  assert.equal(tribalSeatForMembership(holder.memberships![0]), reference);
  assert.equal(tribalSeatForMembership({...holder.memberships![0],current:false}), null);
  assert.equal(tribalSeatForMembership({...holder.memberships![0],district:"unrelated seat"}), null);
  const selected = seatHolderForMembership(holder,"test:current-membership")!;
  assert.equal(selected.representation,"tribal");
  assert.equal(selected.nation,reference.nation);
  const listings = tribalSeatListingsFor(reference.state,[selected]);
  assert.equal(listings.length,tribalSeatReferencesFor(reference.state).length);
  assert.equal(listings.find(row => row.reference === reference)?.holders[0].name,holder.name);
  assert.ok(listings.filter(row => row.reference !== reference).every(row => row.holders.length === 0));
});

test("unknown tribal holders are never called vacant; a vacancy requires the official roster's dated statement", () => {
  const reference = TRIBAL_SEAT_REFERENCES[0];
  const seat = tribalSeatListingsFor(reference.state,[]).find(row => row.reference === reference)!;
  assert.equal(seat.vacant,false);
  assert.deepEqual(seat.holders,[]);
  assert.equal(tribalSeatIsVacant({...reference,status:{value:"vacant",sourceUrl:"https://example.org/absent-from-a-feed",checkedAt:"2026-10-12"}}),false);
  assert.equal(tribalSeatIsVacant({...reference,status:{value:"vacant",sourceUrl:reference.officialRosterUrl,checkedAt:""}}),false);
  assert.equal(tribalSeatIsVacant({...reference,status:{value:"vacant",sourceUrl:reference.officialRosterUrl,checkedAt:"2026-10-12"}}),true);
});

test("supplemental district sources replace the Census default and keep actual publishers", () => {
  const reference = TRIBAL_SEAT_REFERENCES[0];
  const boundary = {sourceUrl:"https://boundary.example.gov/file.zip",sourceOrg:"Boundary publisher",collectedAt:"2026-10-12",verifiedAt:null};
  const sources = districtCardSources([],[],undefined,[boundary]);
  assert.deepEqual(sources.map(source => source.provenance.sourceUrl),[boundary.sourceUrl]);
  const tribalSources = tribalSeatSources(reference);
  assert.ok(tribalSources.some(source => source.sourceUrl === reference.officialRosterUrl));
  for (const record of reference.sourceRecords ?? []) {
    assert.equal(tribalSources.find(source => source.sourceUrl === record.url)?.sourceOrg,record.org);
    if (record.what) assert.equal(tribalSeatCardSources(reference).find(source => source.provenance.sourceUrl === record.url)?.what,record.what);
  }
});

test("the real reference seats all render on the legislature page with the exact plain description and sources", () => {
  const state = TRIBAL_SEAT_REFERENCES[0].state;
  const html = renderToStaticMarkup(createElement(LegislatureDirectory,{state,holders:[holderFor()],unavailable:false}));
  for (const reference of tribalSeatReferencesFor(state)) {
    assert.ok(html.includes(`data-tribal-seat="${reference.district}"`));
    assert.ok(html.includes(tribalSeatDescription(reference.nation).replaceAll("'","&#x27;")));
    assert.ok(html.includes(reference.officialRosterUrl));
  }
  assert.ok(html.includes("Sources"));
  assert.ok(html.includes("Sourced Representative"));
  assert.ok(html.includes("data-working-on-it"),"a sourced seat lacking a holder remains an explicit information gap");
});

test("one address retains its base and overlay district, with independent labels", () => {
  const base = "ocd-division/country:us/state:nh/sldl:507";
  const overlay = "ocd-division/country:us/state:nh/sldl:508";
  const coverage = {seats:[{ocdId:base,label:"Merrimack 7",divisionType:"sldl",tier:"state",representatives:[]},
    {ocdId:overlay,label:"Merrimack 8",divisionType:"sldl",tier:"state",representation:"overlay",representatives:[]}]} as unknown as CoverageSummary;
  const panel = panelSeatsFor(coverage,{certainty:"ADDRESS_RESOLVED",zip:"03255",confirmedDivisionIds:[base,overlay],splitLevels:[]},STATE_SEAT_TYPES);
  assert.deepEqual(panel.yours.map(row => row.ocdId),[base,overlay]);
  assert.ok(panel.yours.every(row => row.standing === "CONFIRMED"));
  assert.deepEqual(panel.yours.map(row => legislativeRepresentationLabel(row.divisionType,row.representation)),["Base district","Overlay district"]);
  assert.deepEqual(panel.excluded,[]);
});

test("a confirmed base district does not discard an overlay whose point hit is still unknown", () => {
  const base = "ocd-division/country:us/state:nh/sldl:507";
  const overlay = "ocd-division/country:us/state:nh/sldl:MER08";
  const coverage = {seats:[{ocdId:base,label:"Merrimack 7",divisionType:"sldl",tier:"state",representatives:[]},
    {ocdId:overlay,label:"Merrimack 8",divisionType:"sldl",tier:"state",representation:"overlay",representatives:[]}]} as unknown as CoverageSummary;
  const panel = panelSeatsFor(coverage,{certainty:"ADDRESS_RESOLVED",zip:"03255",confirmedDivisionIds:[base],splitLevels:[]},STATE_SEAT_TYPES);
  assert.deepEqual(panel.yours.map(row => row.ocdId),[base,overlay]);
  assert.equal(panel.yours[0].standing,"CONFIRMED");
  assert.equal(panel.yours[1].standing,"OVERLAP_NOT_RULED_OUT");
  assert.deepEqual(panel.excluded,[]);
  const resolved = panelSeatsFor(coverage,{certainty:"ADDRESS_RESOLVED",zip:"03255",confirmedDivisionIds:[base],splitLevels:[],excludedDivisionIds:[overlay]},STATE_SEAT_TYPES);
  assert.deepEqual(resolved.yours.map(row => row.ocdId),[base]);
  assert.deepEqual(resolved.excluded.map(row => row.ocdId),[overlay]);
  assert.equal(resolved.excluded[0].standing,"ELSEWHERE_IN_ZIP");
});
