import assert from "node:assert/strict";
import test from "node:test";

import { composeBodyRoster, composeReaderOfficials, readerOfficialsQuestion, stateDivisionsOf, type HeldOfficial } from "../lib/ask/reader-officials.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const AZ = "ocd-division/country:us/state:az";
const seat = (id: string, name: string, officeTitle: string, partyLabel: string | null = "Republican"): SeatHolder => ({
  id, name, officeTitle, partyLabel, termEnd: null, birthDate: null, websiteUrl: null, sourceUrl: `https://example.gov/${id}`, provenance: null, email: null, phone: null,
  contactFormUrl: null, photoUrl: null, campaignUrl: null,
});
const held = (s: SeatHolder, divisionIds: string[] = [], body: { id: string; name: string } | null = null): HeldOfficial => ({ seat: s, divisionIds, bodyId: body?.id ?? null, bodyName: body?.name ?? null });

test("a missing requested official needs the AI fallback even when other officials are held", () => {
  const answer = composeReaderOfficials({ ask: readerOfficialsQuestion("Who is my governor?")!, holdingFailed: false,
    held: [held(seat("senator", "Casey Example", "United States Senator"), [AZ])] });
  assert.equal(answer?.answer, "We have not recorded who your governor is yet.");
  assert.equal(answer?.missingAnswer, true);
  assert.deepEqual(answer?.citedUrls, []);
});

test("the closed forms are read; a qualifier, a second subject or an unlisted office is left to the model", () => {
  const accepted: [string, string[]][] = [
    ["Who is my state senator?", ["state_senator"]],
    ["who's my congressman", ["us_representative"]],
    ["Who are my state representatives?", ["state_lower_house"]],
    ["Who represents me in Congress?", ["us_senator", "us_representative"]],
    ["Who is my U.S. senator?", ["us_senator"]],
    ["Who is my senator?", ["us_senator", "state_senator"]],
    ["Who is my county supervisor?", ["county_supervisor"]],
    ["Who is my mayor?", ["mayor"]],
    ["Who is my governor?", ["governor"]],
    ["Who are my elected officials?", ["us_senator", "us_representative", "governor", "state_senator", "state_lower_house"]],
    ["Who is my school board member?", ["school_board"]],
    ["List my legislators", ["state_senator", "state_lower_house"]],
  ];
  for (const [question, keys] of accepted) assert.deepEqual(readerOfficialsQuestion(question)?.keys, keys, question);
  for (const question of [
    "Who is my state senator and how did she vote on the budget?",
    "Who is my dogcatcher?",
    "Who is Katie Hobbs?",
    "Who is the state senator for Mesa?",
    "What did my county supervisor decide?",
    "",
  ]) assert.equal(readerOfficialsQuestion(question), null, question);
});

test("one district: the holder is named with their district and party", () => {
  const ask = readerOfficialsQuestion("Who is my state senator?")!;
  const answer = composeReaderOfficials({ ask, holdingFailed: false, held: [held(seat("s19", "David Gowan", "State Senator"), [`${AZ}/sldu:19`]), held(seat("s17", "Other Person", "State Senator"), [`${AZ}/sldu:17`])] });
  assert.equal(answer?.answer, "Your ZIP code reaches 2 state senate districts: Other Person (Republican) for District 17 and David Gowan (Republican) for District 19.");
  const single = composeReaderOfficials({ ask, holdingFailed: false, held: [held(seat("s19", "David Gowan", "State Senator"), [`${AZ}/sldu:19`])] });
  assert.equal(single?.answer, "Your state senator is David Gowan (Republican) for District 19.");
  assert.deepEqual(single?.citedUrls, ["https://example.gov/s19"]);
  assert.deepEqual(single?.named.map((entry) => entry.seat.id), ["s19"]);
});

test("a multi-member district names every member once, and a ZIP that reaches two districts names both", () => {
  const ask = readerOfficialsQuestion("Who are my state representatives?")!;
  const houses = [
    held(seat("h1", "A One", "State Representative"), [`${AZ}/sldl:19`]),
    held(seat("h2", "B Two", "State Representative"), [`${AZ}/sldl:19`]),
    held(seat("h3", "C Three", "State Representative", "Democratic"), [`${AZ}/sldl:17`]),
    held(seat("h3", "C Three", "State Representative", "Democratic"), [`${AZ}/sldl:17`]),
  ];
  const answer = composeReaderOfficials({ ask, holdingFailed: false, held: houses });
  assert.equal(answer?.answer, "Your ZIP code reaches 2 state house districts: C Three (Democratic) for District 17 and A One (Republican) and B Two (Republican) for District 19.");
  assert.equal(answer?.named.length, 3, "one person is named once however many divisions hold them");
});

test("the federal offices are spelled out, so the length contract does not count U.S. as a sentence end", () => {
  const ask = readerOfficialsQuestion("Who represents me in Congress?")!;
  const answer = composeReaderOfficials({
    ask, holdingFailed: false,
    held: [
      held(seat("k", "Mark Kelly", "U.S. Senator", "Democrat"), [AZ]),
      held(seat("g", "Ruben Gallego", "U.S. Senator", "Democrat"), [AZ]),
      held(seat("c", "Juan Ciscomani", "U.S. Representative"), [`${AZ}/cd:6`]),
    ],
  });
  assert.equal(answer?.answer, "Your United States Senators are Mark Kelly (Democrat) and Ruben Gallego (Democrat); your United States Representative is Juan Ciscomani (Republican) for District 6.");
});

test("a body's seats are named with the body; a seat that depends on the address says we do not hold it", () => {
  const board = { id: "ocd-division/country:us/state:az/county:pima#governing", name: "Pima County Board Of Supervisors" };
  const supervisors = [1, 2, 3].map((n) => held(seat(`p${n}`, `Person ${n}`, `County Supervisor, District ${n}${n === 2 ? " (Vice Chair)" : ""}`, n === 3 ? null : "Democratic"), [], board));
  const answer = composeReaderOfficials({ ask: readerOfficialsQuestion("Who is my county supervisor?")!, holdingFailed: false, held: supervisors });
  assert.equal(answer?.answer,
    "Pima County Board of Supervisors has 3 county supervisors: Person 1 (Democratic, District 1), Person 2 (Democratic, District 2), and Person 3 (District 3). We have not recorded which county supervisor district your address is in, so we cannot say which of them is yours.");
  assert.deepEqual(answer?.gaps.map((gap) => gap.whose), ["OURS"]);
  const mayor = composeReaderOfficials({ ask: readerOfficialsQuestion("Who is my mayor?")!, holdingFailed: false, held: [held(seat("m", "Regina Romero", "Mayor", "Democratic"), [], { id: "x#governing", name: "Tucson Mayor & Council" })] });
  assert.equal(mayor?.answer, "On Tucson Mayor & Council, the mayor is Regina Romero (Democratic).");
});

test("a school board's seats are known by the body they sit on, and its superintendent is not a board member", () => {
  const board = { id: "ocd-division/country:us/state:az/school_district:vail_unified_district#board", name: "Vail Unified School District Governing Board" };
  const answer = composeReaderOfficials({
    ask: readerOfficialsQuestion("Who is my school board member?")!, holdingFailed: false,
    held: [held(seat("a", "Allison Pratt", "Governing Board President", null), [], board), held(seat("b", "Ed Buster", "Governing Board Member", null), [], board), held(seat("s", "John Carruth", "Superintendent", null), [], board)],
  });
  assert.equal(answer?.answer, "Vail Unified School District Governing Board has 2 school board members: Allison Pratt and Ed Buster.");
});

test("an office we hold no one for is said as a gap of ours; a failed read is said as a failure of ours, never as no one holding it", () => {
  const ask = readerOfficialsQuestion("Who is my mayor?")!;
  const none = composeReaderOfficials({ ask, holdingFailed: false, held: [] });
  assert.equal(none?.answer, "We have not recorded who your mayor is yet.");
  assert.deepEqual(none?.gaps, [{ whose: "OURS", statement: "We have not recorded who holds the office of mayor for your area yet." }]);
  const failed = composeReaderOfficials({ ask, holdingFailed: true, held: [] });
  assert.match(failed?.answer ?? "", /couldn't load the name of your mayor/);
  assert.match(failed?.gaps[0]?.statement ?? "", /couldn't load our records of who holds this office/);
  assert.doesNotMatch(failed?.gaps[0]?.statement ?? "", /no one holds|holding|canonical|projection/);
});

test("the state each division sits in is read, because the U.S. Senators and the statewide executives are held under it", () => {
  assert.deepEqual(stateDivisionsOf([`${AZ}/cd:6`, `${AZ}/county:pima`, "ocd-division/country:us/state:nh/place:concord"]), [AZ, "ocd-division/country:us/state:nh"]);
  assert.deepEqual(stateDivisionsOf(["ocd-division/country:us"]), []);
});

test("a roster is composed alphabetically with roles beside names, its staff after, and its gaps in their own words", () => {
  const contacts = [
    { name: "Allison Pratt", officeTitle: "Governing Board President", basis: "BODY_MEMBER", sourceUrl: "https://example.gov/r" },
    { name: "Chris King", officeTitle: "Governing Board Member", basis: "BODY_MEMBER", sourceUrl: "https://example.gov/r" },
    { name: "Jennifer Allen", officeTitle: "County Supervisor, District 3 (Chair)", basis: "BODY_MEMBER", sourceUrl: "https://example.gov/s" },
    { name: "John Carruth", officeTitle: "Superintendent", basis: "BODY_STAFF", sourceUrl: "https://example.gov/r" },
  ];
  assert.deepEqual(composeBodyRoster({ bodyName: "Vail Unified School District Governing Board", contacts, gaps: [{ whose: "OURS", statement: "One seat is not yet identified." }] }), {
    answer: "Vail Unified School District Governing Board has 3 members: Allison Pratt (Governing Board President), Chris King, and Jennifer Allen (County Supervisor, District 3, Chair). Its roster also lists John Carruth (Superintendent). One seat is not yet identified.",
    citedUrls: ["https://example.gov/r", "https://example.gov/s"],
  });
  assert.equal(composeBodyRoster({ bodyName: "Sierra Vista", contacts: [], gaps: [] })?.answer, "We have not recorded who sits on Sierra Vista yet.");
});

test("how to reach my officials: the same offices, each person with the phone and email their office publishes — and a gap of ours where none is held", () => {
  for (const [question, keys] of [
    ["How do I contact my state representative?", ["state_lower_house"]],
    ["How can I reach my congressman?", ["us_representative"]],
    ["What is my state senator's phone number?", ["state_senator"]],
    ["What is the email address for my governor?", ["governor"]],
  ] as const) {
    const ask = readerOfficialsQuestion(question);
    assert.deepEqual(ask?.keys, keys, question);
    assert.equal(ask?.contact, true, question);
  }
  assert.equal(readerOfficialsQuestion("Who is my state senator?")?.contact, undefined);
  assert.equal(readerOfficialsQuestion("How do I contact my landlord?"), null);
  const reachable = { ...seat("s19", "David Gowan", "State Senator"), phone: "(602) 926-5154", email: "dgowan@example.gov" };
  const ask = readerOfficialsQuestion("How do I contact my state senator?")!;
  const answer = composeReaderOfficials({ ask, holdingFailed: false, held: [held(reachable, [`${AZ}/sldu:19`])] });
  assert.equal(answer?.answer, "Your state senator is David Gowan (Republican, phone (602) 926-5154, email dgowan@example.gov) for District 19.");
  const silent = composeReaderOfficials({ ask, holdingFailed: false, held: [held(seat("s19", "David Gowan", "State Senator"), [`${AZ}/sldu:19`])] });
  assert.match(silent?.answer ?? "", /We have not recorded a published phone number or email for David Gowan\.$/);
  assert.deepEqual(silent?.gaps.map((gap) => gap.whose), ["OURS"]);
});

test("a ZIP that reaches more than one place does not say which city's mayor or council is the reader's", () => {
  const mayor = held(seat("m", "Regina Romero", "Mayor", "Democratic"), [], { id: "x#governing", name: "Tucson Mayor & Council" });
  const ask = readerOfficialsQuestion("Who is my mayor?")!;
  const many = composeReaderOfficials({ ask, holdingFailed: false, held: [mayor], placesReached: 4 });
  assert.equal(many?.answer, "On Tucson Mayor & Council, the mayor is Regina Romero (Democratic). Your ZIP code reaches 4 places, so a ZIP code alone does not say which city's mayor is yours.");
  assert.deepEqual(many?.gaps.map((gap) => gap.whose), ["OURS"]);
  assert.equal(composeReaderOfficials({ ask, holdingFailed: false, held: [mayor], placesReached: 1 })?.answer, "On Tucson Mayor & Council, the mayor is Regina Romero (Democratic).");
  assert.equal(readerOfficialsQuestion("Who is my sheriff?")?.keys[0], "county_sheriff");
  assert.equal(composeReaderOfficials({ ask: readerOfficialsQuestion("Who is my sheriff?")!, holdingFailed: false, held: [] })?.answer, "We have not recorded who your county sheriff is yet.");
});

test("a statewide office of the state the reader is in is read too — 'the governor of Arizona', 'Arizona's senators', and a bare 'who is the governor' — and no other state", () => {
  const az = ["az"];
  for (const [question, keys] of [
    ["Who is the governor of Arizona?", ["governor"]],
    ["Who is Arizona's attorney general?", ["attorney_general"]],
    ["Who are the senators from Arizona?", ["us_senator"]],
    ["Who is the secretary of state of Arizona?", ["secretary_of_state"]],
    ["Who is the governor?", ["governor"]],
  ] as const) assert.deepEqual(readerOfficialsQuestion(question, az)?.keys, keys, question);
  assert.equal(readerOfficialsQuestion("Who is the governor of Texas?", az), null, "a state the reader's divisions do not reach is the model's");
  assert.equal(readerOfficialsQuestion("Who is the governor?", ["az", "nj"]), null, "a bare office with two states in view is ambiguous");
  assert.equal(readerOfficialsQuestion("Who is the governor of Arizona?", []), null, "no state resolved: never answered");
  assert.equal(readerOfficialsQuestion("Who is the state senator of Arizona?", az), null, "a legislator is a district's, not the state's");
  assert.equal(readerOfficialsQuestion("Who is the mayor of Arizona?", az), null);
});

test("the mayor or council of the one city the reader's divisions reach can be asked for by the city's name", () => {
  const sierraVista = ["sierra vista"];
  assert.deepEqual(readerOfficialsQuestion("Who is the mayor of Sierra Vista?", ["az"], sierraVista)?.keys, ["mayor"]);
  assert.deepEqual(readerOfficialsQuestion("Who is the mayor of the city of Sierra Vista, AZ?", ["az"], sierraVista)?.keys, ["mayor"]);
  assert.deepEqual(readerOfficialsQuestion("Who is Sierra Vista's mayor?", ["az"], sierraVista)?.keys, ["mayor"]);
  assert.deepEqual(readerOfficialsQuestion("Who are the council members of Sierra Vista?", ["az"], sierraVista)?.keys, ["municipal_council"]);
  assert.equal(readerOfficialsQuestion("Who is the mayor of Tucson?", ["az"], sierraVista), null, "a city the reader's divisions do not reach is the model's");
  assert.equal(readerOfficialsQuestion("Who is the mayor of Sierra Vista?", ["az"], ["sierra vista", "huachuca city"])?.place, "sierra_vista", "the city named is the city answered, however many the ZIP reaches");
  assert.equal(readerOfficialsQuestion("Who is the mayor of Huachuca City?", ["az"], ["sierra vista", "huachuca city"])?.place, "huachuca_city");
  assert.equal(readerOfficialsQuestion("Who is the mayor of Sierra Vista Southeast?", ["az"], ["sierra vista"]), null, "a longer name is not the shorter city");
  assert.equal(readerOfficialsQuestion("Who is the sheriff of Sierra Vista?", ["az"], sierraVista), null, "a county office is not a city's");
  assert.equal(readerOfficialsQuestion("Who is the mayor of Sierra Vista?"), null, "no reader places, no reading");
});

test("a city named in the question is answered from that city's holders alone, even when the ZIP reaches other places", () => {
  const ask = readerOfficialsQuestion("Who is the mayor of Sierra Vista?", ["az"], ["sierra vista", "sierra vista southeast"])!;
  const mayor = held(seat("m1", "Clea McCaa II", "Mayor"), [`${AZ}/place:sierra_vista`]);
  const other = held(seat("m2", "Someone Else", "Mayor"), [`${AZ}/place:huachuca_city`]);
  const answer = composeReaderOfficials({ ask, holdingFailed: false, held: [mayor, other], placesReached: 3 });
  assert.match(answer?.answer ?? "", /Clea McCaa II/);
  assert.doesNotMatch(answer?.answer ?? "", /Someone Else|reaches 3 places/);
});
