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
