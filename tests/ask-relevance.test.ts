import assert from "node:assert/strict";
import test from "node:test";

import { gateContactsToSubject, gateRecordsToSubject } from "../lib/ask/relevance.ts";
import type { EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import type { AskContact } from "../lib/ask/contacts.ts";

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

function contact(over: Partial<AskContact>): AskContact {
  return {
    id: "c", name: "n", officeTitle: "t", relationship: "r", basis: "BODY_MEMBER",
    email: null, phone: null, websiteUrl: null, sourceUrl: null, sourceOrg: null, retrievedAt: null,
    ...over,
  };
}

test("SEEDED: a MEASURE drops the reader-representative fallback from WHO THIS IS", () => {
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
