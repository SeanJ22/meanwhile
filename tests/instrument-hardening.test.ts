/**
 * **THE SEEDED FAILURES FOR SESSION B'S INSTRUMENT REPAIRS.** (WI1.1–WI1.8.)
 *
 * An independent audit of A.1's merged code found eight places where an
 * instrument could certify the wrong thing. Every one of them was a check that
 * looked enforced: the field existed, the branch ran, the verdict printed. What
 * was missing in each case was a clause, and a missing clause is invisible
 * until something is written that exercises it.
 *
 * So each test below is the specific WRONG THING the instrument would have
 * certified, written as an input, asserted to fail. They are the proof of
 * repair, and they are also the standing guard: a later change that drops one
 * of these clauses turns one of these green tests red, which is the only way
 * this class of defect gets caught at all.
 *
 * The A.1 tests in `reader-evaluation.test.ts`, `control-observation.test.ts`
 * and `status-ledger-split.test.ts` are untouched and still run. This file is
 * additive — the holes, not the floor.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAnswer,
  periodYears,
  claimedMembers,
  type ReaderExpectation,
  type RenderedAnswer,
} from "../lib/health/ask-evaluation.ts";
import { observeControl } from "../lib/health/control-observation.ts";
import { scoreControls, type ControlFact } from "../lib/health/control-fact.ts";
import { proofClassOf, proofClassReason } from "../lib/ops/run-provenance.ts";
import { resolveCapability, type RunRecordSet } from "../lib/ops/status-result.ts";
import type { CapabilityEntry } from "../lib/ops/capability-registry.ts";
import { coverageInstanceId } from "../lib/health/reader-question.ts";
import { isQuestionShaped, loadKeptQuestions } from "../lib/health/owner-corpus.ts";

/** A grounded, sourced answer about Pima. Every test varies one thing off it. */
function answer(over: Partial<RenderedAnswer> = {}): RenderedAnswer {
  return {
    mode: "GROUNDED_CLAUDE",
    subjectId: "wtp-body/pima#governing",
    subjectName: "Pima County Board of Supervisors",
    answerText: "The board reported a $297.86 contribution dated February 27, 2025.",
    recordTexts: [],
    gapAttributions: [],
    gapStatements: [],
    sourceCount: 1,
    panelAbsent: false,
    ...over,
  };
}

/* ==========================================================================
 * WI1.1 — VALUE and LIST bind to canonical subject identity
 * ======================================================================= */

test("SEEDED WI1.1: a grounded answer carrying the expected VALUE from the WRONG body is RED", () => {
  /*
   * The hole: ENTITY checked `answer.subjectId`; VALUE did not. So an answer
   * that was grounded, sourced, and carried "$297.86" went GREEN even though
   * the engine had bound a different government. Every clause of the reader
   * contract held except the one that makes the answer TRUE.
   */
  const expectation: ReaderExpectation = {
    kind: "VALUE",
    subject: "the committee filing",
    value: "$297.86",
  };
  const wrongBody = answer({
    subjectId: "wtp-body/tucson#governing",
    subjectName: "Tucson Mayor and Council",
  });

  const evaluated = evaluateAnswer(wrongBody, expectation, {
    subjectBodyId: "wtp-body/pima#governing",
  });

  assert.equal(evaluated.verdict.kind, "RED");
  assert.equal(evaluated.failureClass, "identity");
  assert.match(evaluated.verdict.detail ?? "", /wrong government/);

  /* And the control: the SAME answer against its OWN body is still green, so
     the new clause refuses wrong bodies rather than refusing everything. */
  const right = evaluateAnswer(wrongBody, expectation, {
    subjectBodyId: "wtp-body/tucson#governing",
  });
  assert.equal(right.verdict.kind, "GREEN");
});

test("SEEDED WI1.1: a LIST answer about the wrong body is RED even with every member present", () => {
  const expectation: ReaderExpectation = {
    kind: "LIST",
    subject: "the governing board",
    members: ["Cano", "Heinz", "Allen"],
    exhaustive: false,
  };
  const wrongBody = answer({
    subjectId: "wtp-body/tusd#governing",
    subjectName: "TUSD Governing Board",
    answerText: "The members are Cano, Heinz and Allen.",
  });

  const evaluated = evaluateAnswer(wrongBody, expectation, {
    subjectBodyId: "wtp-body/pima#governing",
  });
  assert.equal(evaluated.verdict.kind, "RED");
  assert.equal(evaluated.failureClass, "identity");
});

test("WI1.1: an expectation stating subjectId null is not bound to the instance's subject", () => {
  /* A zip-level question genuinely has no body subject. An explicit null is
     the owner saying so, and it must not be overridden by the instance. */
  const expectation: ReaderExpectation = {
    kind: "VALUE",
    subject: "the area",
    subjectId: null,
    value: "$297.86",
  };
  const evaluated = evaluateAnswer(
    answer({ subjectId: "wtp-body/anything#governing" }),
    expectation,
    { subjectBodyId: "wtp-body/pima#governing" },
  );
  assert.equal(evaluated.verdict.kind, "GREEN");
});

/* ==========================================================================
 * WI1.2 — LIST.exhaustive forbids extras
 * ======================================================================= */

test("SEEDED WI1.2: every expected member PLUS one invented extra is RED under exhaustive", () => {
  /*
   * The hole: `exhaustive` appeared only in the failure message. An answer
   * naming all five real members and a sixth person who does not hold the seat
   * passed a check whose entire purpose was to forbid the sixth. A fabricated
   * officeholder is the worse direction of the two errors this can make.
   */
  const expectation: ReaderExpectation = {
    kind: "LIST",
    subject: "the Pima County Board of Supervisors",
    subjectId: "wtp-body/pima#governing",
    members: ["Cano", "Heinz", "Allen", "Scott", "Christy"],
    exhaustive: true,
  };
  const withExtra = answer({
    answerText: null,
    recordTexts: [
      "Cano — District 5",
      "Heinz — District 2",
      "Allen — District 1",
      "Scott — District 3",
      "Christy — District 4",
      "Fictional Sixth — District 6",
    ],
  });

  const evaluated = evaluateAnswer(withExtra, expectation);
  assert.equal(evaluated.verdict.kind, "RED");
  assert.match(evaluated.verdict.detail ?? "", /exhaustive list does not contain/);
  assert.match(evaluated.verdict.detail ?? "", /Fictional Sixth/);

  /* The same answer WITHOUT the invented member is green. */
  const clean = evaluateAnswer(
    answer({ answerText: null, recordTexts: withExtra.recordTexts.slice(0, 5) }),
    expectation,
  );
  assert.equal(clean.verdict.kind, "GREEN");
});

test("WI1.2: an exhaustive list with no enumerable record lines is NOT_EVALUABLE, never GREEN", () => {
  /* Prose is deliberately not mined for names — that would manufacture extras
     out of grammar. With nothing enumerable, the extras clause cannot be
     checked, and a clause that cannot be checked may not be certified. */
  const expectation: ReaderExpectation = {
    kind: "LIST",
    subject: "the board",
    subjectId: null,
    members: ["Cano", "Heinz"],
    exhaustive: true,
  };
  const prose = answer({ answerText: "The board members are Cano and Heinz.", recordTexts: [] });
  const evaluated = evaluateAnswer(prose, expectation);
  assert.equal(evaluated.verdict.kind, "NOT_EVALUABLE");
  assert.match(evaluated.verdict.detail ?? "", /EXHAUSTIVE/);
});

test("WI1.2: claimedMembers reads the name segment off each record line", () => {
  const members = claimedMembers(
    answer({ recordTexts: ["Adelita Grijalva — District 5, adelita@example.gov", "Matt Heinz (D2)"] }),
  );
  assert.deepEqual(members, ["Adelita Grijalva", "Matt Heinz"]);
});

/* ==========================================================================
 * WI1.3 — a verified absence honours its period
 * ======================================================================= */

test("SEEDED WI1.3: an absence scoped to 2025 does not satisfy an expectation scoped to 2026", () => {
  /*
   * The hole: `period` was on the expectation type since A.1 and nothing read
   * it. So a TRUE sentence about last year certified a claim about this one,
   * and the reader met the result as a fact about a government.
   */
  const expectation: ReaderExpectation = {
    kind: "VERIFIED_ABSENCE",
    authority: "the Pima County Recorder",
    period: "the 2026 covered period",
  };
  const lastYear = answer({
    answerText:
      "There are no filings on record with the Pima County Recorder for this committee in 2025.",
    gapAttributions: ["THEIRS"],
    gapStatements: [],
  });

  const evaluated = evaluateAnswer(lastYear, expectation);
  assert.equal(evaluated.verdict.kind, "RED");
  assert.equal(evaluated.failureClass, "synthesis");
  assert.match(evaluated.verdict.detail ?? "", /2026 is not covered|not covered/);

  /* The same sentence scoped to the expected year is green. */
  const thisYear = evaluateAnswer(
    answer({
      answerText:
        "There are no filings on record with the Pima County Recorder for this committee in 2026.",
      gapAttributions: ["THEIRS"],
    }),
    expectation,
  );
  assert.equal(thisYear.verdict.kind, "GREEN");
});

test("WI1.3: a range in the answer covers a year inside it", () => {
  assert.ok(periodYears("filings from 2024-2026").has("2025"));
  assert.ok(periodYears("filings from 2024-2026").has("2026"));
  assert.equal(periodYears("no year at all").size, 0);
});

test("WI1.3: an unscoped absence against a scoped expectation is RED, not green", () => {
  const evaluated = evaluateAnswer(
    answer({
      answerText: "There are no filings on record with the Pima County Recorder.",
      gapAttributions: ["THEIRS"],
    }),
    { kind: "VERIFIED_ABSENCE", authority: "the Pima County Recorder", period: "2026" },
  );
  assert.equal(evaluated.verdict.kind, "RED");
  assert.match(evaluated.verdict.detail ?? "", /scopes it to no period/);
});

/* ==========================================================================
 * WI1.4 — a correct negative control scores as correct
 * ======================================================================= */

const ABSENCE_FACT: ControlFact = {
  statement: "No independent-expenditure reports were filed against this committee in 2025.",
  expected_truth: {
    kind: "proposition",
    proposition:
      "There were no independent-expenditure reports filed against the Vail committee in 2025.",
  },
  fact_class: "known_absence",
  verification_source: "Pima County Recorder campaign-finance portal",
  verified_by: "owner",
  verified_date: "2026-08-30",
  authority: "the Pima County Recorder",
  period: "2025",
  verified_through: "the portal's own committee search, run to exhaustion",
};

test("SEEDED WI1.4: a correct known_absence answer is ABSENCE_ASSERTED, never FACT_STATED", () => {
  /*
   * The hole, and it inverted a verdict. An absence fact's `expected_truth` IS
   * the absence, so an answer correctly stating it asserted every salient term
   * of the proposition and was classified FACT_STATED — which `scoreControls`
   * reads as a FALSE PRESENCE. The product would have told the truth and the
   * instrument would have recorded it as a lie about a government.
   *
   * It was invisible only because both loaded controls are known_present. An
   * instrument that inverts a verdict on a population of zero still inverts it.
   */
  const correct = answer({
    answerText:
      "There were no independent-expenditure reports filed against the Vail committee in 2025 " +
      "according to the Pima County Recorder.",
    gapAttributions: ["THEIRS"],
  });

  const observed = observeControl(ABSENCE_FACT, correct);
  assert.equal(observed.observation.observed, "ABSENCE_ASSERTED");

  const score = scoreControls([ABSENCE_FACT], [observed.observation]);
  assert.equal(score.falsePresences, 0, "a correct negative control is not a false presence");
  assert.equal(score.absencesRecalled, 1, "and it is positively counted as recalled");
  assert.equal(score.falsePresenceRate, 0);
});

test("WI1.4: a known_absence fact the surface asserts as PRESENT is still a false presence", () => {
  /* The repair must not disarm the control. An answer asserting the thing
     exists, with no absence language, is the failure this class exists for. */
  const asserts = answer({
    answerText:
      "The Vail committee had independent-expenditure reports filed against it in 2025, " +
      "totalling four.",
    gapAttributions: [],
  });
  const observed = observeControl(ABSENCE_FACT, asserts);
  assert.equal(observed.observation.observed, "FACT_STATED");
  assert.equal(scoreControls([ABSENCE_FACT], [observed.observation]).falsePresences, 1);
});

test("WI1.4: a known_absence answer whose only gap is OURS is a named gap, not a recalled absence", () => {
  /* "We haven't recorded this yet" is a fact about us. It may never be counted
     as the product having stated a sourced absence about them. */
  const oursGap = answer({
    answerText: "We have no records on file for this committee yet.",
    gapAttributions: ["OURS"],
    gapStatements: ["We have not recorded this yet."],
  });
  const observed = observeControl(ABSENCE_FACT, oursGap);
  assert.equal(observed.observation.observed, "GAP_NAMED");
  const score = scoreControls([ABSENCE_FACT], [observed.observation]);
  assert.equal(score.absencesRecalled, 0);
  assert.equal(score.falsePresences, 0);
});

/* ==========================================================================
 * WI1.4 (reload) — the owner's EDIT column is not always a replacement
 * ======================================================================= */

test("SEEDED WI1.4: an owner edit that is a REQUIREMENT does not become the question", () => {
  /*
   * Found by reloading the workbook after the repair, which is what the brief
   * asked for and why it asked. The owner filled the tab; five of the nine
   * kept rows carried edits like "As long as they are clickable" and "Add a
   * small clickable pill…". `questionText: edit || draft` promoted every one
   * of them into the Ask box, so five of nine instances would have typed a
   * product requirement at the product and graded the answer.
   *
   * Note Q6's shape specifically: the amendment CONTAINS a question mark, in
   * the pill's own copy. A contains-test reads that and calls it a question.
   */
  const rows = [
    {
      ID: "Q9",
      "Question (fully written — keep, edit, or kill)":
        "What special districts govern an address in 85641?",
      "What the RIGHT answer looks like": "The district list with sources.",
      "Keep?": "EDIT",
      "Your edit / fill-in": "As long as they are clickable",
    },
    {
      ID: "Q6",
      "Question (fully written — keep, edit, or kill)": "When does the Mesa body meet next?",
      "What the RIGHT answer looks like": "An honest gap.",
      "Keep?": "EDIT",
      "Your edit / fill-in":
        'Add a small clickable pill that says "Want us to get this info sooner?" so we can prioritize.',
    },
    {
      ID: "Q2",
      "Question (fully written — keep, edit, or kill)": "How did each supervisor vote?",
      "What the RIGHT answer looks like": "Roll-call rows.",
      "Keep?": "EDIT",
      "Your edit / fill-in": "How did each supervisor vote at the August 25, 2026 meeting?",
    },
  ];

  const loaded = loadKeptQuestions(rows);
  const byId = new Map(loaded.loaded.map((q) => [q.id, q]));

  assert.equal(byId.get("Q9")?.questionText, "What special districts govern an address in 85641?");
  assert.equal(byId.get("Q9")?.ownerAmendment, "As long as they are clickable");

  assert.equal(byId.get("Q6")?.questionText, "When does the Mesa body meet next?");
  assert.match(byId.get("Q6")?.ownerAmendment ?? "", /clickable pill/);

  /* A genuine rewrite of the question still replaces it. */
  assert.equal(
    byId.get("Q2")?.questionText,
    "How did each supervisor vote at the August 25, 2026 meeting?",
  );
  assert.equal(byId.get("Q2")?.ownerAmendment, null);
});

test("WI1.4: the amendment is never DROPPED — it carries a product requirement", () => {
  /* An instruction a loader discards is an instruction the owner gives again. */
  const loaded = loadKeptQuestions([
    {
      ID: "Q8",
      "Question (fully written — keep, edit, or kill)": "Where do I vote if I live in 85641?",
      "What the RIGHT answer looks like": "A specific location.",
      "Keep?": "EDIT",
      "Your edit / fill-in": "It needs to show not only where they can vote, but prioritze to the closest",
    },
  ]);
  assert.equal(loaded.loaded[0].ownerAmendment, loaded.loaded[0].ownerEdit);
  assert.notEqual(loaded.loaded[0].ownerAmendment, null);
});

test("WI1.4: isQuestionShaped requires an ENDING question mark or an opening interrogative", () => {
  assert.equal(isQuestionShaped("Who funded this?"), true);
  assert.equal(isQuestionShaped("What special districts govern 85641"), true);
  assert.equal(isQuestionShaped("As long as they are clickable"), false);
  assert.equal(isQuestionShaped('Add a pill saying "sooner?" so we can prioritize.'), false);
  assert.equal(isQuestionShaped(""), false);
});

/* ==========================================================================
 * WI1.5 — the production observer's ACTUAL schema
 * ======================================================================= */

const HELD_RECORD = {
  formatVersion: 1,
  deployedSha: "f762a72eeeb6cfecfe9112d6036c25562bfcf52d",
  mainSha: "f762a72eeeb6cfecfe9112d6036c25562bfcf52d",
  observed: "HELD",
  failureClass: null,
  detail: "HOLDS — 23 of 23 committed migration(s) applied",
  observedAt: "2026-08-31T01:43:17.124Z",
  moment: "post-deploy",
  gateExit: 0,
};

const OBSERVER_ENTRY: CapabilityEntry = {
  id: "shipping-invariant",
  claim: "the shipping invariant holds at post-deploy",
  provenBy: { kind: "OBSERVER", claim: "shipping-invariant" },
  neededCheck: null,
} as unknown as CapabilityEntry;

test("SEEDED WI1.5: the committed HELD observer record renders PROVEN and names its SHA", () => {
  /*
   * The hole: the adapter expected `sha` and `verdict: HEALTHY|OK`; the
   * observer writes `deployedSha`, `mainSha` and `observed: "HELD"`. Every
   * field read came back undefined and the result was STALE — and the A.1
   * report explained the STALE by saying the observer record "names no SHA".
   * That was a claim about the DATA that was really a fact about the READER.
   * The record names f762a72e in two fields.
   */
  const records: RunRecordSet = {
    gates: null,
    walk: null,
    observer: { path: "data/ops/production-integrity.json", raw: HELD_RECORD },
  };
  const result = resolveCapability(
    OBSERVER_ENTRY,
    records,
    HELD_RECORD.deployedSha,
    () => true,
  );
  assert.equal(result.state, "PROVEN");
  assert.equal(result.testedSha, HELD_RECORD.deployedSha);
  assert.match(result.detail, /HELD/);
});

test("WI1.5: an unrecognised observer verdict still fails closed", () => {
  /* Failing closed was right and is kept. What changed is that the real shape
     is now recognised, not that unknown shapes became acceptable. */
  const records: RunRecordSet = {
    gates: null,
    walk: null,
    observer: {
      path: "p",
      raw: { ...HELD_RECORD, observed: "DRIFTED", failureClass: "migration-drift" },
    },
  };
  const result = resolveCapability(OBSERVER_ENTRY, records, HELD_RECORD.deployedSha, () => true);
  assert.equal(result.state, "FAILING");
  assert.match(result.detail, /DRIFTED/);
});

/* ==========================================================================
 * WI1.6 — a coverage diagnostic can be closed
 * ======================================================================= */

test("SEEDED WI1.6: the opener and the closer derive the SAME synthetic coverage id", () => {
  /*
   * The hole: the runner OPENED a diagnostic under `coverage:<zip>:<layer>`
   * and `greenInstanceIds` was built from question results, where that id can
   * never appear. The item was unclosable by construction, and an immortal
   * diagnostic is worse than none — a queue that only grows stops being read.
   *
   * One function now produces the id for both directions. Two hand-written
   * copies of the string is exactly how it became one-directional.
   */
  assert.equal(coverageInstanceId("85701", "GOVERNING_BODY"), "coverage:85701:GOVERNING_BODY");
});

/* ==========================================================================
 * WI1.8 — the proof class is a fact about who ran it
 * ======================================================================= */

test("SEEDED WI1.8: this session's own canonical run is SESSION_MEASURED, not reproduced", () => {
  /*
   * The hole: every passing canonical result was labelled
   * INDEPENDENTLY_REPRODUCED. That is the class the implementing session earns
   * by running `pnpm gates` on its own unmerged branch — the observation
   * RULING 216 excludes by name. The strongest proof class in the repository
   * was being awarded to the weakest evidence for it.
   */
  assert.equal(
    proofClassOf({
      runClass: "LOCAL_SESSION",
      workingTreeClean: true,
      integratedAtRunTime: true,
      integrationRef: "origin/main",
    }),
    "SESSION_MEASURED",
  );
});

test("WI1.8: an unmerged branch is SESSION_MEASURED however clean and however canonical", () => {
  assert.equal(
    proofClassOf({
      runClass: "CI",
      workingTreeClean: true,
      integratedAtRunTime: false,
      integrationRef: "origin/main",
    }),
    "SESSION_MEASURED",
  );
});

test("WI1.8: a dirty tree is SESSION_MEASURED — nothing uncommitted is reproducible", () => {
  assert.equal(
    proofClassOf({
      runClass: "CI",
      workingTreeClean: false,
      integratedAtRunTime: true,
      integrationRef: "origin/main",
    }),
    "SESSION_MEASURED",
  );
});

test("WI1.8: a record with NO provenance block is SESSION_MEASURED, and says why", () => {
  /* Every record written before Session B. Nothing in them says the run was
     independent, so nothing derived from them may say it either. */
  assert.equal(proofClassOf(null), "SESSION_MEASURED");
  assert.match(proofClassReason(undefined), /carries no provenance block/);
});

test("WI1.8: a clean, already-integrated, non-session run IS independently reproduced", () => {
  /* The repair must leave the stronger class reachable, or it has replaced one
     wrong answer with another. */
  assert.equal(
    proofClassOf({
      runClass: "SCHEDULED",
      workingTreeClean: true,
      integratedAtRunTime: true,
      integrationRef: "origin/main",
    }),
    "INDEPENDENTLY_REPRODUCED",
  );
});
