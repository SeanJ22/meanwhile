import assert from "node:assert/strict";
import test from "node:test";

import {
  asksWhatAnOfficeDoes,
  officeInQuestion,
} from "../lib/ask/office-question.ts";
import { OFFICE_BLURBS } from "../lib/officials/office-blurbs.ts";

// A question about what an office does reaches the definition we hold; a person question or an unheld office does not.

/* --------------------------------------------------- the named example --- */

test("ASK-14: the governor question finds the governor's own definition", () => {
  const match = officeInQuestion("What does the governor do?");
  assert.equal(match?.office, "governor");
  assert.equal(match?.blurb.text, OFFICE_BLURBS.governor.text);
  // The definition is sourced, which is what lets it reach a reader at all.
  assert.ok((match?.blurb.basis ?? "").length > 0, "a definition without a basis may not ship");
});

/* ------------------------------------------------ the unnamed controls --- */

test("ASK-14 control: offices nobody named resolve the same way", () => {
  const cases: [string, string][] = [
    ["What does a county supervisor do?", "county-commissioner"],
    ["What does a school board do?", "school-board"],
    ["what does the mayor control", "mayor"],
    ["What does my state representative do?", "state-representative"],
    ["what does the sheriff handle", "county-sheriff"],
    ["What is the secretary of state responsible for?", "secretary-of-state"],
  ];
  for (const [question, office] of cases) {
    assert.equal(officeInQuestion(question)?.office, office, question);
  }
});

test("ASK-14 control: the longest phrase wins, so near-names do not collide", () => {
  // Each of these CONTAINS a shorter office phrase, and the shorter one is a
  // genuinely different job. This is the whole reason matching is by length.
  assert.equal(officeInQuestion("what does the county attorney do")?.office, "county-attorney");
  assert.equal(officeInQuestion("what does the attorney general do")?.office, "attorney-general");
  assert.equal(
    officeInQuestion("what does the superintendent of public instruction do")?.office,
    "superintendent-public-instruction",
  );
  assert.equal(officeInQuestion("what does the county clerk do")?.office, "county-clerk");
  assert.equal(officeInQuestion("what does a us senator do")?.office, "us-senator");
});

/* --------------------------------------------------- negative controls --- */

test("ASK-14 negative control: naming an office is not asking what it does", () => {
  // Naming an office in a person question must not answer with a job description.
  assert.equal(asksWhatAnOfficeDoes("Who is the governor?"), false);
  assert.equal(asksWhatAnOfficeDoes("Who is my mayor"), false);
  assert.equal(asksWhatAnOfficeDoes("When does the school board meet?"), false);

  // ...and the questions that ARE about the office pass it.
  assert.equal(asksWhatAnOfficeDoes("What does the governor do?"), true);
  assert.equal(asksWhatAnOfficeDoes("what does this office control"), true);
  assert.equal(asksWhatAnOfficeDoes("what powers does the mayor have"), true);
});

test("ASK-14 negative control: an office we hold no definition for gets nothing", () => {
  // A missing definition is never described from memory.
  assert.equal(officeInQuestion("what does the harbourmaster do"), null);
  assert.equal(officeInQuestion("what does the dogcatcher do"), null);
  assert.equal(officeInQuestion("what does the president do"), null);
});

test("ASK-14 negative control: a bare word inside another office does not match it", () => {
  // A substring match would answer the wrong office.
  assert.equal(officeInQuestion("what does the court clerk do"), null);
});

/* -------------------------------------------------------- the contract --- */

test("ASK-14: every office the vocabulary can return has a definition behind it", () => {
  // A vocabulary entry pointing at an office with no blurb would return an
  // empty record and read to a reader as a confident nothing.
  const questions = [
    "what does the governor do",
    "what does a county supervisor do",
    "what does a school board do",
    "what does the mayor do",
    "what does the sheriff do",
    "what does the county treasurer do",
    "what does the mine inspector do",
    "what does the register of deeds do",
    "what does a select board do",
    "what does an executive councilor do",
  ];
  for (const q of questions) {
    const match = officeInQuestion(q);
    assert.ok(match, q);
    assert.ok(match.blurb.text.length > 40, `${match.office} has no usable definition`);
    assert.ok(match.blurb.basis.length > 0, `${match.office} has no basis`);
  }
});
