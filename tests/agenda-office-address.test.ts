import assert from "node:assert/strict";
import test from "node:test";
import { agendaLetterheadOffice, agendaLetterheadOfficeEvidence, agendaMeetingAddress, statedAgendaAddress } from "../lib/meetings/agenda-address.ts";

const examples = [
  {state:"WI",jurisdiction:"CITY OF MILWAUKEE",header:"City Hall\n City of Milwaukee 200 East Wells Street\n Milwaukee, Wi 53202\n\n Meeting Agenda\n JUDICIARY & LEGISLATION COMMITTEE\n Monday, July 6, 2026 9:00 AM Room 301-B, City Hall",
    address:"200 East Wells Street, Milwaukee, WI 53202",quote:"200 East Wells Street Milwaukee, Wi 53202"},
  {state:"WA",jurisdiction:"COUNTY OF WHATCOM",header:"Whatcom County\nCouncil Committee of the Whole\nCOUNTY COURTHOUSE\n311 Grand Avenue, Ste #105\nBellingham, WA 98225-4038\n(360) 778-5010\nMeeting Agenda\nTuesday, July 14, 2026\n3:20 PM\nHybrid Meeting - Council Chambers",
    address:"311 Grand Avenue, Bellingham, WA 98225-4038",quote:"311 Grand Avenue, Ste #105 Bellingham, WA 98225-4038"},
  {state:"CA",jurisdiction:"COUNTY OF EL DORADO",header:"Planning and Building\nCounty of El Dorado Department\n2850 Fairlane Court\nPlacerville CA 95667\nMEETING AGENDA www.edcgov.us\nPlanning Commission\nThursday, July 9, 2026 9:00 AM",
    address:"2850 Fairlane Court, Placerville, CA 95667",quote:"2850 Fairlane Court Placerville CA 95667"},
  {state:"WI",jurisdiction:"COUNTY OF MILWAUKEE",header:"Marcia P. Coggs Health\nMilwaukee County and Human Services\nCenter\n1230 W. Cherry St.,\nMeeting Agenda - Final Milwaukee, WI 53205\nCommission on Aging\nCommissioner Denise Callaway, Chair",
    address:"1230 W. Cherry St., Milwaukee, WI 53205",quote:"1230 W. Cherry St., Meeting Agenda - Final Milwaukee, WI 53205"},
];

for(const example of examples)test(`issuing-office headers retain literal evidence while parsing ${example.jurisdiction} locality formatting`,()=>{
  assert.deepEqual(agendaLetterheadOfficeEvidence(example.header,example.jurisdiction,example.state),{address:example.address,quote:example.quote});
  assert.equal(agendaLetterheadOffice(example.header,example.jurisdiction,example.state),example.address);
  assert.ok(example.header.replace(/\s+/g," ").includes(example.quote),"the quote is a literal source span, including units, case and interleaved title");
  assert.equal(agendaLetterheadOffice(example.header,example.jurisdiction,"AZ"),null,"a different state cannot borrow this office");
});

test("written states and a missing city comma are parsed without rewriting the office evidence",()=>{
  const header="City Council\n100 Main Street, Room 300\nLincoln Nebraska 68508\nMeeting Agenda";
  assert.deepEqual(agendaLetterheadOfficeEvidence(header,"City of Lincoln","NE"),{
    address:"100 Main Street, Lincoln, NE 68508",quote:"100 Main Street, Room 300 Lincoln Nebraska 68508"});
  assert.deepEqual([statedAgendaAddress(header)?.city,statedAgendaAddress(header)?.state,statedAgendaAddress(header)?.zip],["Lincoln","NE","68508"]);
});

test("a PDF supervisor column does not turn its district number into the meeting house number",()=>{
  const header="County of San Diego\nBoard of Supervisors\nMeeting Agenda\nTuesday, August 18, 2026\nSupervisor Jim Desmond County Administration Center\nDistrict 5 1600 Paciﬁc Highway\nEbony N. Shelton\nRoom 310 (Board Chamber)\nChief Administrative Oﬃcer San Diego, CA 92101";
  assert.equal(agendaMeetingAddress(header,"CA"),"1600 Pacific Highway, San Diego, CA 92101");
  assert.equal(agendaLetterheadOffice(header,"County of San Diego","CA"),null,"a meeting address after the date is not its board's office header");
});

test("a meeting's full written state and suffix remain its own venue rather than an issuing-office claim",()=>{
  const header="Cumberland County\nBoard of Trustees Cross Insurance Arena\nMeeting Agenda - Final\nMeeting Location: Hall of Fame Lounge\nWednesday, September 2, 2026 9:00 AM Cross Insurance Arena\nHall of Fame Lounge\n1 Civic Center Square\nPortland Maine\nCALL TO ORDER\nROLL CALL";
  assert.equal(agendaMeetingAddress(header,"ME"),"1 Civic Center Square, Portland, ME");
  assert.equal(agendaLetterheadOffice(header,"County of Cumberland","ME"),null);
});

test("the office header and the sitting's different printed venue stay separate",()=>{
  const header="City of Example\n100 Main Street\nExample, AZ 85001\nMeeting Agenda\nMonday, July 6, 2026 9:00 AM\nMeeting Location: 200 Other Avenue, Example, AZ 85002\nCALL TO ORDER";
  assert.equal(agendaLetterheadOffice(header,"City of Example","AZ"),"100 Main Street, Example, AZ 85001");
  assert.equal(agendaMeetingAddress(header,"AZ"),"200 Other Avenue, Example, AZ 85002");
});

test("another street's locality and addresses in agenda items do not fill a missing office",()=>{
  const split="Board\n100 Unlocated Street\nMeeting Agenda\nMeeting Location: 200 Other Avenue\nNeighbor, AZ 85002";
  assert.equal(agendaLetterheadOffice(split,"City of Example","AZ"),null);
  for(const header of ["Board\nMeeting Agenda\nCALL TO ORDER\nPublic hearing for 123 Main Street, Example, AZ 85001",
    "Board\nMeeting Agenda\n"+" ".repeat(700)+"123 Main Street, Example, AZ 85001"]){
    assert.equal(agendaLetterheadOffice(header,"City of Example","AZ"),null);
    assert.equal(agendaMeetingAddress(header,"AZ"),null);
  }
});


test("an issuing address block after the title and before the date remains an office, while an explicit meeting-location label does not",()=>{
  const header="City of Tacoma\nCommittee of the Whole Agenda\n747 Market Street, Tacoma, WA 98402\nCouncil Chambers\nOctober 23, 2026\n8:00 AM";
  assert.equal(agendaLetterheadOffice(header,"City of Tacoma","WA"),"747 Market Street, Tacoma, WA 98402");
  const venue="Cumberland County\nBoard of Assessment Review\nMeeting Agenda - Final\nMeeting Location: 27 Northport Drive, Portland ME 04103\nTuesday, July 21, 2026 5:00 PM";
  assert.equal(agendaLetterheadOffice(venue,"County of Cumberland","ME"),null);
  assert.equal(agendaMeetingAddress(venue,"ME"),"27 Northport Drive, Portland, ME 04103");
});


test("saved minutes supply the issuing board's header address without borrowing an address in their decisions",()=>{
  const header="City of Example\n100 Main Street\nExample, Arizona 85001\nMeeting Minutes\nMonday, July 6, 2026 9:00 AM\nCALL TO ORDER\nApproved a permit at 200 Other Avenue, Neighbor, AZ 85002";
  assert.deepEqual(agendaLetterheadOfficeEvidence(header,"City of Example","AZ"),{
    address:"100 Main Street, Example, AZ 85001",quote:"100 Main Street Example, Arizona 85001"});
  assert.equal(agendaMeetingAddress(header,"AZ"),null);
  assert.equal(agendaLetterheadOffice("City of Example\nMinutes\nMonday, July 6, 2026\nCALL TO ORDER\nPermit at 200 Other Avenue, Neighbor, AZ 85002","City of Example","AZ"),null);
});
