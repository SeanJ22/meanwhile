import assert from "node:assert/strict";
import test from "node:test";
import { needsSecondSource, section3Contest, section3Page, section3Record } from "../lib/control-plane/promotion/section3.ts";

const NOW = "2026-09-29T20:00:00.000Z";
const page = (text: string, url = "https://recorder.cochise.az.gov/candidates", retrievedAt = "2026-09-29T12:00:00.000Z") => ({ url, text, retrievedAt });
const LIST = `<h1>2026 General Election — Candidate List</h1><table><tr><td>Sheriff</td><td>Mark Dannels</td></tr><tr><td>Sheriff</td><td>Jane Ortiz</td></tr></table>`;

test("the page half: an official page inside its window passes; a stale or unofficial one does not", () => {
  assert.equal(section3Page(page(LIST), "BALLOT_CONTEST", NOW).ok, true);
  assert.match(section3Page(page(LIST, undefined, "2026-09-01T00:00:00.000Z"), "BALLOT_CONTEST", NOW).reason!, /OUTSIDE_FRESHNESS_WINDOW/);
  assert.match(section3Page(page(LIST, "https://candidates.example.com/list"), "BALLOT_CONTEST", NOW).reason!, /NOT_OFFICIAL_SOURCE/);
});

test("the record half: minimum facts put a record live; other fields attach only when on the page", () => {
  const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: { name: "Mark Dannels", office: "Sheriff", phone: "(520) 555-0100" }, page: page(LIST), now: NOW });
  assert.deepEqual([verdict.live, verdict.verifiedFields, verdict.openFields], [true, ["name", "office"], ["phone"]]);
  assert.equal(needsSecondSource({ recordClass: "OFFICIAL_ROSTER", requiredFields: ["name", "photoUrl"] }), true, "a portrait is a judgment call");
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
