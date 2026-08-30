import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_INTENT_READING,
  QUESTION_CLASSES,
  RECORD_CLASSES,
  RecordClassRefused,
  answers,
  assertAnswerable,
  evidenceRecordsFor,
  recordClassesAnswering,
  refusalFor,
  ruleOnQuestion,
} from "../lib/answerability/record-class.ts";

/**
 * **AN AGENDA IS NOT AN OUTCOME.**
 *
 * Every test in this file is one half of a pair. The seeded failure proves
 * the substitution is refused; the POSITIVE CONTROL immediately after it
 * proves the refusal is a rule about evidence and not a module that simply
 * says no — a guard that refuses everything protects nothing and gets
 * deleted the first time it blocks real work.
 *
 * Nothing here re-implements the matrix. Every assertion goes through the
 * exported functions, so a test passing means the shipped rule holds, not
 * that a copy of it in a test file holds.
 */

/* ══════════════════════════════════════════════════════════════════════
   1 · SEEDED FAILURE — AN AGENDA OFFERED AS PROOF OF A PAST VOTE
   ══════════════════════════════════════════════════════════════════════ */

test("SEEDED FAILURE: an agenda may not answer how a member voted", () => {
  assert.equal(
    answers("AGENDA", "HOW_DID_THEY_VOTE"),
    false,
    "an agenda proves an item was scheduled, never that a vote was taken on it",
  );

  const ruling = ruleOnQuestion("HOW_DID_THEY_VOTE", ["AGENDA"]);
  assert.equal(ruling.answerable, false);
  assert.deepEqual(ruling.satisfiedBy, []);
  assert.deepEqual(ruling.requires, ["ROLL_CALL"]);
  assert.equal(ruling.refusedSubstitutions.length, 1);
  assert.equal(ruling.refusedSubstitutions[0].held, "AGENDA");
  assert.match(
    ruling.refusedSubstitutions[0].reason,
    /roll call is the only record of how one member voted/i,
    "the refusal has to say WHAT would answer it, or the next session cannot act on it",
  );
});

test("SEEDED FAILURE: an agenda-only corpus THROWS on a vote question", () => {
  /*
   * `ruleOnQuestion` is advice a caller can ignore. `assertAnswerable` is the
   * wall — this is the "mechanically impossible" half of the requirement.
   */
  assert.throws(
    () => assertAnswerable("HOW_DID_THEY_VOTE", ["AGENDA", "AGENDA_PACKET", "MEETING_NOTICE"]),
    (error: unknown) => {
      assert.ok(error instanceof RecordClassRefused, "the refusal is its own named error");
      assert.equal(error.ruling.answerable, false);
      assert.match(error.message, /HOW_DID_THEY_VOTE needs one of \[ROLL_CALL\]/);
      return true;
    },
  );
});

test("SEEDED FAILURE: an agenda may not answer what was decided", () => {
  assert.equal(answers("AGENDA", "WHAT_WAS_DECIDED"), false);
  assert.match(
    refusalFor("AGENDA", "WHAT_WAS_DECIDED"),
    /continued, withdrawn, tabled and pulled from consent/i,
    "the sentence names the mechanism — items move and the agenda does not",
  );
  assert.throws(
    () => assertAnswerable("WHAT_WAS_DECIDED", ["AGENDA"]),
    RecordClassRefused,
  );
});

test("POSITIVE CONTROL: the same agenda answers what was NOTICED", () => {
  /*
   * The half that makes the three above honest. If an agenda answered
   * nothing, the refusals would be a broken module rather than a rule.
   */
  assert.equal(answers("AGENDA", "WHAT_WAS_NOTICED"), true);
  const ruling = assertAnswerable("WHAT_WAS_NOTICED", ["AGENDA"]);
  assert.equal(ruling.answerable, true);
  assert.deepEqual(ruling.satisfiedBy, ["AGENDA"]);
  assert.deepEqual(ruling.refusedSubstitutions, []);
});

test("POSITIVE CONTROL: a ROLL_CALL answers the vote question the agenda could not", () => {
  const ruling = assertAnswerable("HOW_DID_THEY_VOTE", ["AGENDA", "ROLL_CALL"]);
  assert.equal(ruling.answerable, true);
  assert.deepEqual(ruling.satisfiedBy, ["ROLL_CALL"]);
  assert.deepEqual(
    ruling.refusedSubstitutions.map((r) => r.held),
    ["AGENDA"],
    "the agenda is still refused BY NAME even when the question is answerable — " +
      "a record that cannot answer is not laundered by one that can",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   2 · THE TALLY IS NOT A MEMBER'S POSITION
   ══════════════════════════════════════════════════════════════════════ */

test("SEEDED FAILURE: minutes carrying a tally may not answer how one member voted", () => {
  assert.equal(answers("MINUTES", "HOW_DID_THEY_VOTE"), false);
  assert.equal(answers("ACTION_SUMMARY", "HOW_DID_THEY_VOTE"), false);
  assert.match(refusalFor("MINUTES", "HOW_DID_THEY_VOTE"), /tally/i);
});

test("POSITIVE CONTROL: minutes DO answer what was decided", () => {
  const ruling = assertAnswerable("WHAT_WAS_DECIDED", ["MINUTES"]);
  assert.equal(ruling.answerable, true);
  assert.deepEqual(ruling.satisfiedBy, ["MINUTES"]);
});

test("SEEDED FAILURE: minutes may not be read as the docket that was noticed", () => {
  /*
   * The mirror image of the agenda rule, and the one a reviewer usually
   * misses. An item continued to the next sitting is ON the agenda and
   * ABSENT from the minutes; a docket read off minutes silently drops it.
   */
  assert.equal(answers("MINUTES", "WHAT_WAS_NOTICED"), false);
  assert.match(refusalFor("MINUTES", "WHAT_WAS_NOTICED"), /continued to the\s+next sitting/i);
});

/* ══════════════════════════════════════════════════════════════════════
   3 · THE ALLOW-LIST FAILS SAFE
   ══════════════════════════════════════════════════════════════════════ */

test("an unknown record class answers NOTHING", () => {
  for (const questionClass of QUESTION_CLASSES) {
    assert.equal(
      answers("SOME_NEW_THING_WE_ADDED", questionClass),
      false,
      `an unclassified record must not answer ${questionClass}`,
    );
  }
  assert.match(
    refusalFor("SOME_NEW_THING_WE_ADDED", "WHAT_WAS_DECIDED"),
    /not a record class this rule knows/i,
  );
});

test("an empty corpus is refused, and the refusal says so plainly", () => {
  const ruling = ruleOnQuestion("WHAT_WAS_NOTICED", []);
  assert.equal(ruling.answerable, false);
  assert.deepEqual(ruling.refusedSubstitutions, []);
  assert.throws(
    () => assertAnswerable("WHAT_WAS_NOTICED", []),
    /No records are held at all/,
  );
});

test("every declared record class answers at least one question class", () => {
  // A class that answers nothing is dead vocabulary; a question class no
  // record answers is an obligation with no route to it. Both are defects.
  for (const recordClass of RECORD_CLASSES) {
    const answered = QUESTION_CLASSES.filter((q) => answers(recordClass, q));
    assert.ok(answered.length > 0, `${recordClass} answers nothing`);
  }
  for (const questionClass of QUESTION_CLASSES) {
    assert.ok(
      recordClassesAnswering(questionClass).length > 0,
      `${questionClass} has no record class that can answer it`,
    );
  }
});

test("PAST_MEETING reads to NO question class, and the ambiguity is the point", () => {
  /*
   * "What happened at the last meeting?" is ambiguous between *what was
   * noticed* and *what was decided*. A pipeline that resolves that by
   * reaching for whatever it holds hands a reader an agenda as an account of
   * a decision. The null forces the interpretation rung to decide.
   */
  assert.equal(ASK_INTENT_READING.PAST_MEETING, null);
  assert.equal(ASK_INTENT_READING.UPCOMING_AGENDA, "WHAT_WAS_NOTICED");
  assert.equal(ASK_INTENT_READING.AGENDA_TOPIC, "WHAT_WAS_NOTICED");
  assert.equal(ASK_INTENT_READING.MEETING_TIME, "WHEN_DO_THEY_MEET");
});

/* ══════════════════════════════════════════════════════════════════════
   4 · THE FILTER REMOVES, IT DOES NOT MERELY FLAG
   ══════════════════════════════════════════════════════════════════════ */

test("SEEDED FAILURE: agenda records cannot be handed to an outcome answer", () => {
  const held = [
    { id: "agenda-1", recordClass: "AGENDA" },
    { id: "agenda-2", recordClass: "AGENDA" },
    { id: "packet-1", recordClass: "AGENDA_PACKET" },
  ];
  const { admitted, refused } = evidenceRecordsFor("WHAT_WAS_DECIDED", held);
  assert.deepEqual(admitted, [], "not flagged — GONE. A caller cannot use what it does not have");
  assert.equal(refused.length, 3, "and nothing is silently dropped either");
  for (const entry of refused) {
    assert.ok(entry.reason.length > 0, "every excluded record carries its own sentence");
  }
});

test("POSITIVE CONTROL: the same three records survive the noticed question", () => {
  const held = [
    { id: "agenda-1", recordClass: "AGENDA" },
    { id: "agenda-2", recordClass: "AGENDA" },
    { id: "packet-1", recordClass: "AGENDA_PACKET" },
  ];
  const { admitted, refused } = evidenceRecordsFor("WHAT_WAS_NOTICED", held);
  assert.deepEqual(
    admitted.map((r) => r.id),
    ["agenda-1", "agenda-2", "packet-1"],
  );
  assert.deepEqual(refused, []);
});

test("a mixed corpus admits only the answering class", () => {
  const held = [
    { id: "agenda-1", recordClass: "AGENDA" },
    { id: "minutes-1", recordClass: "MINUTES" },
    { id: "roll-1", recordClass: "ROLL_CALL" },
  ];
  assert.deepEqual(
    evidenceRecordsFor("WHAT_WAS_DECIDED", held).admitted.map((r) => r.id),
    ["minutes-1", "roll-1"],
  );
  assert.deepEqual(
    evidenceRecordsFor("HOW_DID_THEY_VOTE", held).admitted.map((r) => r.id),
    ["roll-1"],
  );
  assert.deepEqual(
    evidenceRecordsFor("WHAT_WAS_NOTICED", held).admitted.map((r) => r.id),
    ["agenda-1"],
  );
});
