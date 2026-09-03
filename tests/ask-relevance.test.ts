import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { gateContactsToSubject, gateRecordsToSubject } from "../lib/ask/relevance.ts";
import type { EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import type { AskContact } from "../lib/ask/contacts.ts";
import {
  evaluateAnswer,
  type ReaderExpectation,
  type RenderedAnswer,
} from "../lib/health/ask-evaluation.ts";

/**
 * **THE RELEVANCE GATE — nothing outside the question's subject reaches the
 * pack.** (ASK-24, the owner's Prop 141 report, 2026-09-02.)
 *
 * *"Explain Prop 141 to me"* returned the measure explained and then a bullet
 * about the U.S. Senate seat on the 2026 ballot — a real, sourced record that
 * attached only because the measure and the Senate contest share the statewide
 * division — plus three of the reader's own legislators under WHO THIS IS with
 * no stated tie to the measure. Both reached the synthesis rung, where a Senate
 * bullet then got written under a tax-measure question. These pin the gate that
 * removes them BEFORE synthesis, at the id-and-kind level and never by reading
 * prose.
 */

const PROP_141 = "ballot-az-pima:prop-141";
const MEASURE: EvidenceSubject = { kind: "MEASURE", id: PROP_141, name: "Proposition 141" };

function measureRecord(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    kind: "MEASURE_SUMMARY",
    id: `${PROP_141}#summary`,
    subjectId: PROP_141,
    text: "Would change the Arizona Constitution so no tax may be charged per mile driven.",
    sourceUrl: "https://apps.azsos.gov/election/2026/general/prop141.htm",
    ...over,
  };
}

const SENATE_ABSENCE: EvidenceRecord = {
  kind: "BALLOT_ABSENCE",
  id: "absence:ocd-division/country:us/state:az",
  text: "No U.S. Senate seat is on Arizona's 2026 ballot.",
  sourceUrl: "https://apps.azsos.gov/election/2026/general/",
};

/* ══════════════════════════════════════════════════════════════════════
   THE RECORDS GATE
   ══════════════════════════════════════════════════════════════════════ */

test("SEEDED: an off-subject BALLOT_ABSENCE cannot enter a MEASURE's pack — the Senate bullet", () => {
  const { records, excluded } = gateRecordsToSubject(MEASURE, [measureRecord(), SENATE_ABSENCE]);
  assert.deepEqual(
    records.map((r) => r.kind),
    ["MEASURE_SUMMARY"],
    "the measure's own record survives; the ballot-at-large absence does not",
  );
  assert.deepEqual(excluded.map((r) => r.id), [SENATE_ABSENCE.id]);
});

test("SEEDED: a record STAMPED for a different subject cannot enter the pack, whatever its kind", () => {
  /*
   * The general, id-level mechanism — it does not depend on the kind rules. A
   * MEASURE_SUMMARY that belongs to Prop 423 is off-subject in a Prop 141 pack
   * even though its kind is a measure-own kind.
   */
  const foreign = measureRecord({ id: "ballot-az-pima:prop-423#summary", subjectId: "ballot-az-pima:prop-423" });
  const { records, excluded } = gateRecordsToSubject(MEASURE, [measureRecord(), foreign]);
  assert.deepEqual(records.map((r) => r.id), [`${PROP_141}#summary`]);
  assert.deepEqual(excluded.map((r) => r.id), ["ballot-az-pima:prop-423#summary"]);
});

test("a MEASURE keeps its own kinds and its basis-filtered contacts, drops the rest", () => {
  const records: EvidenceRecord[] = [
    measureRecord({ kind: "CONTEST", id: PROP_141, text: "Proposition 141 appears on this ballot." }),
    measureRecord({ kind: "MEASURE_PROVISION", id: `${PROP_141}#p1`, text: "No per-mile tax." }),
    /* A contact record that already survived the CONTACTS gate — its board
       governs the measure's own district — is kept, not re-litigated here. */
    { kind: "CONTACT", id: "wtp-body/vail#governing:pratt", text: "Allison Pratt — Governing Board President on Vail Unified District.", sourceUrl: "https://vail.gov" },
    { kind: "FINANCE_TRANSACTION", id: "cf:1", subjectId: PROP_141, text: "A committee reported a contribution.", sourceUrl: "https://cf.az.gov" },
    SENATE_ABSENCE,
    { kind: "AGENDA_MENTION", id: "sweep:1", text: "A clerk mentioned a mileage study.", sourceUrl: "https://x.gov" },
  ];
  const { records: kept } = gateRecordsToSubject(MEASURE, records);
  assert.deepEqual(
    kept.map((r) => r.kind).sort(),
    ["CONTACT", "CONTEST", "FINANCE_TRANSACTION", "MEASURE_PROVISION"],
    "measure-own kinds, a pre-filtered contact and its finance stay; the absence and sweep mention go",
  );
});

test("a BODY subject drops a record naming a DIFFERENT body, keeps a null-body record", () => {
  const body: EvidenceSubject = { kind: "BODY", id: "vail#board", name: "Vail Unified District" };
  const records: EvidenceRecord[] = [
    { kind: "MEETING", id: "m1", bodyId: "vail#board", text: "Vail board meets Tuesday.", sourceUrl: "https://a" },
    { kind: "MEETING", id: "m2", bodyId: "cawcd#body", text: "Water district meets Monday.", sourceUrl: "https://b" },
    { kind: "AGENDA_ITEM", id: "i1", text: "A budget item.", sourceUrl: "https://c" },
  ];
  const { records: kept, excluded } = gateRecordsToSubject(body, records);
  assert.deepEqual(kept.map((r) => r.id), ["m1", "i1"], "the resolved body's meeting and a null-body item stay");
  assert.deepEqual(excluded.map((r) => r.id), ["m2"], "another body's meeting is off-subject");
});

test("a null subject gates NOTHING — the ballot-at-large question sees every record", () => {
  const { records, excluded } = gateRecordsToSubject(null, [measureRecord(), SENATE_ABSENCE]);
  assert.equal(records.length, 2);
  assert.equal(excluded.length, 0);
});

test("a PERSON pack is not narrowed by the measure kind rule", () => {
  const person: EvidenceSubject = { kind: "PERSON", id: "ballot-az-pima:governor|Katie Hobbs", name: "Katie Hobbs" };
  const records: EvidenceRecord[] = [
    { kind: "OFFICEHOLDER", id: "o", text: "Holds the office of Governor.", sourceUrl: "https://a" },
    { kind: "ROLL_CALL_VOTE", id: "v", text: "Voted yes.", sourceUrl: "https://b" },
  ];
  const { records: kept, excluded } = gateRecordsToSubject(person, records);
  assert.equal(kept.length, 2, "the person's own records are untouched");
  assert.equal(excluded.length, 0);
});

/* ══════════════════════════════════════════════════════════════════════
   THE CONTACTS GATE — WHO THIS IS
   ══════════════════════════════════════════════════════════════════════ */

function contact(over: Partial<AskContact>): AskContact {
  return {
    id: "c", name: "n", officeTitle: "t", relationship: "r", basis: "BODY_MEMBER",
    email: null, phone: null, websiteUrl: null, sourceUrl: null, sourceOrg: null, retrievedAt: null,
    ...over,
  };
}

test("SEEDED: a MEASURE drops the reader-representative fallback from WHO THIS IS", () => {
  /*
   * The three people the owner asked about: *"Your state senator"* is a
   * connection to the READER, not to Proposition 141, so it may not appear under
   * a measure. The measure's own district board is a printed connection and
   * stays — Prop 423's Vail board is the control a blanket drop would break.
   */
  const contacts = [
    contact({ id: "gowan", name: "David Gowan", basis: "READER_REPRESENTATIVE", relationship: "Your state senator" }),
    contact({ id: "pratt", name: "Allison Pratt", basis: "BODY_MEMBER", relationship: "Governing Board President on Vail Unified District" }),
    contact({ id: "carruth", name: "John Carruth", basis: "BODY_STAFF", relationship: "Superintendent of Vail Unified District" }),
  ];
  const { contacts: shown, excluded } = gateContactsToSubject(MEASURE, contacts);
  assert.deepEqual(shown.map((c) => c.name), ["Allison Pratt", "John Carruth"]);
  assert.deepEqual(excluded.map((c) => c.name), ["David Gowan"]);
});

test("a candidate KEEPS the reader-representative fallback — it is the closest honest contact", () => {
  /* The other direction: for a statewide candidate with no roster of its own,
     the reader's legislators are a real relationship, to the reader, and the
     held Andy Biggs answer depends on them still appearing. */
  const person: EvidenceSubject = { kind: "PERSON", id: "ballot-az-pima:governor|Andy Biggs", name: "Andy Biggs" };
  const contacts = [contact({ id: "gowan", name: "David Gowan", basis: "READER_REPRESENTATIVE", relationship: "Your state senator" })];
  const { contacts: shown, excluded } = gateContactsToSubject(person, contacts);
  assert.deepEqual(shown.map((c) => c.name), ["David Gowan"]);
  assert.equal(excluded.length, 0);
});

/* ══════════════════════════════════════════════════════════════════════
   THE CORPUS ENTRY — "Explain Prop 141 to me" — IS GREEN ON A CORRECT ANSWER
   ══════════════════════════════════════════════════════════════════════ */

/** The hand-authored adversarial ReaderQuestion added to the reader corpus. */
function prop141Expectation(): ReaderExpectation {
  const corpus = JSON.parse(
    readFileSync(join(process.cwd(), "data", "health", "reader-questions.json"), "utf8"),
  ) as { id: string; templateText: string; expectation?: ReaderExpectation }[];
  const row = corpus.find((q) => q.id === "Q10");
  assert.ok(row, "the Prop 141 adversarial question is in the reader corpus");
  assert.equal(row!.templateText, "Explain Prop 141 to me");
  assert.ok(row!.expectation, "and it carries a typed expected truth, never a substring");
  return row!.expectation!;
}

function renderedAnswer(over: Partial<RenderedAnswer> = {}): RenderedAnswer {
  return {
    mode: "STRUCTURED_GROUNDED",
    subjectId: "ballot-az-pima:prop-141",
    subjectName: "Proposition 141: Prohibit tax; monitoring; vehicle mileage",
    answerText:
      "Proposition 141 is a proposed change to Arizona's constitution that would " +
      "stop the state and local governments from charging a tax based on how many " +
      "miles you drive, or tracking your mileage without consent.",
    recordTexts: ["Would change the Arizona Constitution so no tax may be charged per mile driven."],
    gapAttributions: [],
    gapStatements: [],
    sourceCount: 1,
    panelAbsent: false,
    ...over,
  };
}

test("CORPUS: a correct, grounded Prop 141 answer evaluates GREEN against the corpus expectation", () => {
  const result = evaluateAnswer(renderedAnswer(), prop141Expectation());
  assert.equal(result.verdict.kind, "GREEN", JSON.stringify(result.verdict));
});

test("CORPUS: an answer bound to a DIFFERENT measure is RED, not a near miss", () => {
  /* The adversarial point at the identity level: a sourced, grounded answer
     about Prop 423 is not an answer to "Explain Prop 141". */
  const wrong = renderedAnswer({
    subjectId: "ballot-az-pima:prop-423",
    subjectName: "Proposition 423: Vail Unified School District budget override continuation",
  });
  const result = evaluateAnswer(wrong, prop141Expectation());
  assert.equal(result.verdict.kind, "RED");
  assert.equal(result.failureClass, "identity");
});

test("CORPUS: a fallback (non-grounded) answer is RED — a measure explained by no engine is not green", () => {
  const fallback = evaluateAnswer(renderedAnswer({ mode: "NO_EVIDENCE" }), prop141Expectation());
  assert.equal(fallback.verdict.kind, "RED");
});
