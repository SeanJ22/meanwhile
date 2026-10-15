import assert from "node:assert/strict";
import test from "node:test";
import { linkingPageFrom, needsSecondSource, pageLinksTo, section3Contest, section3Page, section3Record, valueOnPage } from "../lib/control-plane/promotion/section3.ts";

const NOW = "2026-09-29T20:00:00.000Z";
const page = (text: string, url = "https://recorder.cochise.az.gov/candidates", retrievedAt = "2026-09-29T12:00:00.000Z") => ({ url, text, retrievedAt });
const LIST = `<h1>2026 General Election — Candidate List</h1><table><tr><td>Sheriff</td><td>Mark Dannels</td></tr><tr><td>Sheriff</td><td>Jane Ortiz</td></tr></table>`;

test("an official platform's saved document links retain the platform's government endorsement", () => {
  const official = { url: "https://elections.example.gov/voting", html: '<a href="https://elections.example.net/voting">Voting information</a>' };
  const platform = { canonicalUrl: "https://elections.example.net/voting", text: '<a href="https://documents.example.net/faq.pdf">Election FAQ</a>',
    linkingPage: official };
  const proof = linkingPageFrom("https://documents.example.net/faq.pdf", [platform]);
  assert.deepEqual(proof, { url: platform.canonicalUrl, html: platform.text, linkingPage: official });
  assert.equal(linkingPageFrom("https://documents.example.net/faq.pdf", [{ ...platform, linkingPage: undefined }]), null);
});

test("official navigation resolves relative, unquoted and fragment links against its own page", () => {
  const source = page(`<a href='../forms/sample.pdf'>Sample ballot</a><a href=registration.shtml>Register to vote</a>
    <a href=/Voter/RegisterToVote>Registration form</a><a href='#personal-search'>Registration status</a>
    <a href='//lookup.example.gov/portal'>Find your polling place</a>`, "https://elections.example.gov/elections/voters/index.shtml");
  for (const target of ["https://elections.example.gov/elections/forms/sample.pdf",
    "https://elections.example.gov/elections/voters/registration.shtml", "https://elections.example.gov/Voter/RegisterToVote",
    "https://elections.example.gov/elections/voters/index.shtml#personal-search", "https://lookup.example.gov/portal"]) {
    assert.equal(pageLinksTo(source, target), true, target);
    assert.equal(section3Record({ recordClass: "VOTER_ACCESS_ROUTE", fields: { kind: "POLLING_PLACE_LINK", url: target,
      quote: "Register to vote" }, page: source, now: NOW, minimums: ["kind", "url", "quote"] }).live, true, target);
  }
  for (const target of ["https://another.example.gov/Voter/RegisterToVote",
    "https://elections.example.gov/elections/forms/other.pdf",
    "https://elections.example.gov/elections/voters/index.shtml#missing-search"]) {
    assert.equal(pageLinksTo(source, target), false, target);
    assert.equal(valueOnPage(target, source.text, undefined, source.url), false, target);
  }
  assert.equal(valueOnPage("https://another.example.gov/Voter/RegisterToVote", source.text), false);
});

test("a lookup may use the cited official page itself when its source words verify the route", () => {
  const source = page("<h1>2026 General Election sample ballots</h1>", "https://elections.example.gov/2026/sample-ballots");
  assert.equal(section3Record({ recordClass: "VOTER_ACCESS_ROUTE", fields: { url: source.url, quote: "2026 General Election sample ballots" },
    minimums: ["url", "quote"], page: source, now: NOW }).live, true);
  assert.equal(section3Record({ recordClass: "VOTER_ACCESS_ROUTE", fields: { url: source.url, quote: "Find my registration status" },
    minimums: ["url", "quote"], page: source, now: NOW }).live, false);
});

test("printed official portal addresses retain their whole domain and path when normalized", () => {
  const text = "For voter registration status and sample ballots visit NVSOS.gov/VoterSearch. Visit Vote.Vermont.gov/ to view your sample ballot.";
  assert.equal(valueOnPage("https://www.nvsos.gov/VoterSearch", text), true);
  assert.equal(valueOnPage("https://www.nvsos.gov/VoterSearch", "Visit NVSOS.gov/ VoterSearch to find your sample ballot."), true);
  assert.equal(valueOnPage("https://vote.vermont.gov/", text), true);
  assert.equal(valueOnPage("https://www.nvsos.gov/different", text), false);
  assert.equal(valueOnPage("https://nvsos.gov", "Go to nvsos.gov.attacker.example/"), false);
  assert.equal(valueOnPage("https://nvsos.gov", "Go to http://nvsos.gov"), false);
});

test("the page half: an official page inside its window passes; a stale or unofficial one does not", () => {
  assert.equal(section3Page(page(LIST), "BALLOT_CONTEST", NOW).ok, true);
  assert.match(section3Page(page(LIST, undefined, "2026-09-01T00:00:00.000Z"), "BALLOT_CONTEST", NOW).reason!, /OUTSIDE_FRESHNESS_WINDOW/);
  assert.match(section3Page(page(LIST, "https://candidates.example.com/list"), "BALLOT_CONTEST", NOW).reason!, /LINKED_SOURCE_UNVERIFIED/);
});

test("the record half: minimum facts put a record live; other fields attach only when on the page", () => {
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Mark Dannels", office: "Sheriff", phone: "(520) 555-0100" }, page: page(LIST), now: NOW });
  assert.deepEqual([verdict.live, verdict.verifiedFields, verdict.openFields], [true, ["name", "office"], ["phone"]]);
  assert.equal(needsSecondSource({ recordClass: "OFFICIAL_ROSTER", requiredFields: ["name", "photoUrl"] }), true, "a portrait is a judgment call");
});

test("an AI summary of a stance attaches with the quote it summarizes and needs no second source", () => {
  const statement = page(`<p>On 2026-09-01 the sheriff said: "We will add two deputies in Bisbee."</p>`);
  const fields = { quote: "We will add two deputies in Bisbee.", date: "2026-09-01", statementSummary: "Wants more deputies in Bisbee." };
  const verdict = section3Record({ recordClass: "STANCE", fields, page: statement, now: NOW, minimums: ["quote", "date"] });
  assert.deepEqual([verdict.live, verdict.verifiedFields], [true, ["date", "quote", "statementSummary"]]);
  const unquoted = section3Record({ recordClass: "STANCE", fields: { ...fields, quote: "Words not on the page." }, page: statement, now: NOW, minimums: ["date"] });
  assert.deepEqual(unquoted.openFields, ["quote", "statementSummary"]);
  assert.equal(needsSecondSource({ recordClass: "STANCE", requiredFields: ["quote", "statementSummary"] }), false);
});

test("a contest goes live on its saved official list; each candidate attaches when named there", () => {
  const contest = { election: "2026 General Election", office: "Sheriff", candidates: ["Mark Dannels", "Jane Ortiz", "Pat Nobody"] };
  assert.deepEqual(section3Contest({ page: page(LIST), now: NOW, contest }),
    { live: true, verifiedCandidates: ["Mark Dannels", "Jane Ortiz"], openCandidates: ["Pat Nobody"], reason: null });
  const other = section3Contest({ page: page(LIST), now: NOW, contest: { ...contest, office: "County Attorney" } });
  assert.deepEqual([other.live, other.openCandidates.length], [false, 3]);
  assert.match(other.reason!, /MINIMUM_FACTS_UNVERIFIED: office/);
});

test("a candidate counts only inside their own contest's section, not anywhere on the page", () => {
  const two = `<h1>2026 General Election — Candidate List</h1><h2>Sheriff</h2><p>Mark Dannels</p><p>Jane Ortiz</p><h2>County Attorney</h2><p>Brian McIntyre</p>`;
  const sheriff = section3Contest({ page: page(two), now: NOW, pageOffices: ["Sheriff", "County Attorney"],
    contest: { election: "2026 General Election", office: "Sheriff", candidates: ["Mark Dannels", "Jane Ortiz", "Brian McIntyre"] } });
  assert.deepEqual([sheriff.verifiedCandidates, sheriff.openCandidates], [["Mark Dannels", "Jane Ortiz"], ["Brian McIntyre"]]);
  const attorney = section3Contest({ page: page(two), now: NOW, pageOffices: ["Sheriff", "County Attorney"],
    contest: { election: "2026 General Election", office: "County Attorney", candidates: ["Brian McIntyre", "Mark Dannels"] } });
  assert.deepEqual([attorney.verifiedCandidates, attorney.openCandidates], [["Brian McIntyre"], ["Mark Dannels"]]);
});

test("CP-19: publication leaves a mismatched contact open and publishes each person's minimum facts", () => {
  const source = page('<table><tr><td>Alice Adams</td><td>Clerk</td><td>alice@example.test</td></tr><tr><td>Bob Brown</td><td>Treasurer</td><td>bob@example.test</td></tr></table>');
  const alice = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Alice Adams", office: "Clerk", email: "bob@example.test" }, page: source, now: NOW });
  assert.equal(alice.live, true);
  assert.deepEqual(alice.verifiedFields, ["name", "office"]);
  assert.deepEqual(alice.openFields, ["email"]);
  const bob = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Bob Brown", office: "Treasurer", email: "bob@example.test" }, page: source, now: NOW });
  assert.equal(bob.live, true);
  assert.deepEqual(bob.verifiedFields, ["email", "name", "office"]);
});

test("CP-19: a two-column roster and ambiguous names cannot pool contacts", () => {
  const source = page('<div class="roster"><article><h2>Alice Adams</h2><p>Clerk</p><a href="mailto:alice@example.test">Email</a></article><article><h2>Bob Brown</h2><p>Treasurer</p><a href="mailto:bob@example.test">Email</a></article></div>');
  const fields = { name: "Alice Adams", office: "Clerk", email: "bob@example.test" };
  assert.deepEqual(section3Record({ recordClass: "OFFICIAL_ROSTER", fields, page: source, now: NOW }).openFields, ["email"]);
  const repeated = page('<p>Alice Adams, Clerk, alice@example.test</p><p>Alice Adams, Clerk, bob@example.test</p>');
  assert.equal(section3Record({ recordClass: "OFFICIAL_ROSTER", fields, page: repeated, now: NOW }).live, false);
});


test("CP-19: derived display names anchor on the name actually written in their row", () => {
  const source = page('<table><tr><td>Adams, Alice</td><td>Clerk</td><td>alice@example.test</td></tr><tr><td>Brown, Bob</td><td>Treasurer</td><td>bob@example.test</td></tr></table>');
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Alice Adams", nameAsWritten: "Adams, Alice", office: "Clerk", email: "bob@example.test" }, derived: { name: "nameAsWritten" }, page: source, now: NOW });
  assert.equal(verdict.live, true);
  assert.deepEqual(verdict.verifiedFields, ["name", "nameAsWritten", "office"]);
  assert.deepEqual(verdict.openFields, ["email"]);
});

test("CP-19: identical desktop/mobile rows remain publishable without pooling distinct rows", () => {
  const row = '<tr><td>Alice Adams</td><td>Clerk</td><td>alice@example.test</td></tr>';
  const source = page(`<table>${row}</table><table>${row}</table>`);
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Alice Adams", office: "Clerk", email: "alice@example.test" }, page: source, now: NOW });
  assert.equal(verdict.live, true);
  assert.deepEqual(verdict.verifiedFields, ["email", "name", "office"]);
});

test("CP-19: a heading is its own text block; a neighbouring person's paragraph is not", () => {
  const source = page('<h1>Clerk Alice Adams</h1><p>Bob Brown, bob@example.test</p>');
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Alice Adams", office: "Clerk", email: "bob@example.test" }, page: source, now: NOW });
  assert.equal(verdict.live, true);
  assert.deepEqual(verdict.openFields, ["email"]);
});

test("CP-19: markup formatting a scalar name cell does not detach its own office and contact columns", () => {
  for (const name of ["<div>Alice Adams</div>", "Alice<br>Adams"]) {
    const source = page(`<table><tr><td>${name}</td><td>Clerk</td><td>alice@example.test</td></tr><tr><td>Bob Brown</td><td>Treasurer</td><td>bob@example.test</td></tr></table>`);
    const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Alice Adams", office: "Clerk", email: "alice@example.test" }, page: source, now: NOW });
    assert.equal(verdict.live, true);
    assert.deepEqual(verdict.verifiedFields, ["email", "name", "office"]);
  }
});

test("CP-09: votes, stances and ballot measures require their own minimums", () => {
  for (const [recordClass, fields] of [
    ["VOTE", { person: "Alice Adams", subject: "Budget", position: "Yes", date: "2026-09-28" }],
    ["STANCE", { personId: "alice", quote: "I support parks", date: "2026-09-28" }],
    ["BALLOT_MEASURE", { election: "2026 General", title: "Parks bond", textUrl: "https://town.gov/text" }],
    ["BALLOT_MEASURE", { election: "2026 General", number: "101", textUrl: "https://town.gov/text" }],
  ] as const) {
    const capture = page(JSON.stringify(fields));
    assert.equal(section3Record({ recordClass, fields, page: capture, now: NOW }).live, true);
    const entries = Object.entries(fields);
    const missing = Object.fromEntries(entries.slice(0, -1));
    assert.equal(section3Record({ recordClass, fields: missing, page: capture, now: NOW }).live, false);
  }
});

test("CP-09: a Money record needs an amount and period; its filing document can publish independently", () => {
  const fields = { committeeName: "Friends of Parks", documentUrl: "https://town.gov/filing", filingPeriod: "2026" };
  const capture = page(JSON.stringify(fields));
  assert.equal(section3Record({ recordClass: "CAMPAIGN_FINANCE_FILING", fields, page: capture, now: NOW }).live, false);
  assert.equal(section3Record({ recordClass: "CAMPAIGN_FINANCE_DOCUMENT", fields, page: capture, now: NOW }).live, true);
  const money = { ...fields, amount: 0 };
  assert.equal(section3Record({ recordClass: "CAMPAIGN_FINANCE_FILING", fields: money, page: page(JSON.stringify(money)), now: NOW }).live, true, "a verified zero is an amount");
});


test("CP-06: old upcoming meetings are refused, concluded meetings and serving holdovers remain", () => {
  const fields = { bodyName: "Council", date: "2026-09-25", time: "12:00:00", status: "upcoming" };
  const copy = page("Council 2026-09-25 12:00:00 upcoming concluded");
  assert.match(section3Record({ recordClass: "MEETING", fields, page: copy, now: NOW }).reason!, /DATE_IN_PAST/);
  assert.equal(section3Record({ recordClass: "MEETING", fields: { ...fields, status: "concluded" }, page: copy, now: NOW }).live, true);
  const held = { name: "Jane Ortiz", office: "Sheriff", termEnd: "2025-12-31" };
  assert.equal(section3Record({ recordClass: "OFFICIAL_ROSTER", fields: held,
    page: page("<article>Jane Ortiz Sheriff term end 2025-12-31, serving until successor sworn in</article>"), now: NOW }).live, true);
  assert.equal(section3Record({ recordClass: "OFFICIAL_ROSTER", fields: held,
    page: page("<article>Pat Smith Sheriff</article>"), now: NOW }).live, false);
});
