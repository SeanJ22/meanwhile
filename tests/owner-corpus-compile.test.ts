/**
 * **THE READER CORPUS COMPILER.** (Session B resume, W4.)
 *
 * Written against the state of the corpus on `main` at 68a70354: nine
 * hand-authored questions, all stamped `PER_ZIP`, none carrying an
 * expectation, producing 36 instances and 36 NOT_EVALUABLE. Every test below
 * fails against that behaviour.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  compileExpectation,
  inferApplicability,
  rosterNames,
  unresolvedTokens,
} from "../lib/health/owner-corpus-compile.ts";
import { checkInstanceUniverse, generateInstances } from "../lib/health/reader-question.ts";
import type { ReaderQuestionTemplate } from "../lib/health/reader-question.ts";
import type { KeptQuestion } from "../lib/health/owner-corpus.ts";
import type { ControlFact } from "../lib/health/control-fact.ts";

const NOW = "2026-08-31T12:00:00.000Z";

function question(over: Partial<KeptQuestion> = {}): KeptQuestion {
  return {
    id: "Q",
    questionText: "What happened?",
    rightAnswer: "Something.",
    ownerEdit: "",
    ownerAmendment: null,
    notes: "",
    ...over,
  };
}

/* ------------------------------------------------------------- tokens --- */

test("SEEDED W4: an unresolved token is FOUND, and the closed vocabulary is not", () => {
  assert.deepEqual(
    unresolvedTokens("What actions did the board take at its [F3-date] study session?"),
    ["[F3-date]"],
  );
  assert.deepEqual(unresolvedTokens("Who governs [BODY] in [ZIP]?"), []);
  assert.deepEqual(unresolvedTokens("none on file as of [date]"), ["[date]"]);
});

/* ------------------------------------------------------ applicability --- */

test("SEEDED W4: a question naming a ZIP applies THERE, not to every pilot ZIP", () => {
  const verdict = inferApplicability(question({ questionText: "Where do I vote if I live in 85641?" }));
  assert.equal(verdict.kind, "RESOLVED");
  assert.ok(verdict.kind === "RESOLVED");
  assert.equal(verdict.rule.kind, "SPECIFIC_ZIPS");
  assert.deepEqual(verdict.rule.kind === "SPECIFIC_ZIPS" ? verdict.rule.zips : [], ["85641"]);
});

test("SEEDED W4: a question about a named body binds to that body's ZIP", () => {
  const verdict = inferApplicability(
    question({ questionText: "How did each supervisor vote at the August 25, 2026 meeting?" }),
  );
  assert.ok(verdict.kind === "RESOLVED");
  assert.equal(verdict.rule.kind, "SPECIFIC_BODY");
  assert.deepEqual(verdict.rule.kind === "SPECIFIC_BODY" ? verdict.rule.zips : [], ["85701"]);
});

test("SEEDED W4: an unplaceable question is AMBIGUOUS — never silently PER_ZIP", () => {
  const verdict = inferApplicability(
    question({ questionText: "When does the Mesa body meet next?", rightAnswer: "An honest gap." }),
  );
  assert.equal(
    verdict.kind,
    "AMBIGUOUS",
    "PER_ZIP is a strong claim about scope and may never be a fallback — that default is what " +
      "asked a Pima County question of a New Hampshire town",
  );
});

/* -------------------------------------------------------- expectations --- */

const noFacts = () => null;

test("W4: a figure the owner wrote down compiles to a VALUE that QUOTES it", () => {
  const q = question({
    id: "Q3",
    rightAnswer: "The $297.86 Feb 27 2025 filing, cited to the filing itself.",
  });
  const verdict = compileExpectation(q, noFacts, inferApplicability(q));
  assert.ok(verdict.kind === "COMPILED");
  assert.equal(verdict.compiled.expectation.kind, "VALUE");
  assert.equal(
    verdict.compiled.expectation.kind === "VALUE" ? verdict.compiled.expectation.value : "",
    "$297.86",
  );
  assert.equal(
    verdict.compiled.sourceText,
    q.rightAnswer,
    "the owner's own words travel with the compiled form — the compilation cites, never replaces",
  );
});

test("SEEDED W4: an absence with no stated PERIOD is refused, not dated by guess", () => {
  const q = question({
    id: "Q4",
    rightAnswer: "A sourced absence: 'none on file with Pima County Elections' — never silence.",
  });
  const verdict = compileExpectation(q, noFacts, inferApplicability(q));
  assert.equal(verdict.kind, "NEEDS_OWNER");
  assert.match(
    verdict.kind === "NEEDS_OWNER" ? verdict.needs : "",
    /PERIOD/,
    "a VERIFIED_ABSENCE carries 'through what date'; compiling one without it would misdate the " +
      "verification, which is a fabricated date about a government",
  );
});

test("SEEDED W4: an underdetermined description compiles NOTHING and says what is missing", () => {
  const q = question({ id: "Q9", rightAnswer: "The district list with sources; no district silently missing." });
  const verdict = compileExpectation(q, noFacts, inferApplicability(q));
  assert.equal(verdict.kind, "NEEDS_OWNER");
  assert.match(verdict.kind === "NEEDS_OWNER" ? verdict.needs : "", /enumerate/);
});

/* ------------------------------------------------------------- roster --- */

test("SEEDED W4: the roster is read from the NOTES column, and the instruction is not a name", () => {
  const fact: ControlFact = {
    statement: "The Pima County Board of Supervisors has 5 members.",
    expected_truth: { kind: "proposition", proposition: "x" },
    fact_class: "known_present",
    verification_source: "https://example.gov",
    verified_by: "owner",
    verified_date: "2026-08-30",
  };
  const notes =
    "List names if quick; Supervisor Rex Scott District 1\n" +
    "Supervisor Dr. Matt Heinz District 2\n" +
    "Supervisor Jennifer Allen District 3";
  assert.deepEqual(rosterNames(fact, notes), ["Rex Scott", "Matt Heinz", "Jennifer Allen"]);
});

/* --------------------------------------------------------- generation --- */

const universes = [
  { zip: "85701", divisionIds: [], bodies: [], divisionLabels: new Map<string, string>() },
  { zip: "85641", divisionIds: [], bodies: [], divisionLabels: new Map<string, string>() },
  { zip: "07866", divisionIds: [], bodies: [], divisionLabels: new Map<string, string>() },
  { zip: "03255", divisionIds: [], bodies: [], divisionLabels: new Map<string, string>() },
];

test("SEEDED W4: a ZIP-scoped template makes ONE instance, not one per pilot ZIP", () => {
  const template: ReaderQuestionTemplate = {
    id: "Q8",
    questionClass: "HAND_AUTHORED_ADVERSARIAL",
    templateText: "Where do I vote if I live in 85641?",
    placeholders: [],
    applicability: { kind: "SPECIFIC_ZIPS", zips: ["85641"] },
  };
  const instances = generateInstances([template], universes, NOW);
  assert.equal(
    instances.length,
    1,
    "under PER_ZIP this made four, so three of them asked a question about 85641 of somewhere else",
  );
  assert.equal(instances[0].zip, "85641");
});

test("SEEDED W4: the per-body denominator does NOT hold hand-authored questions to it", () => {
  const template: ReaderQuestionTemplate = {
    id: "Q2",
    questionClass: "HAND_AUTHORED_ADVERSARIAL",
    templateText: "How did each supervisor vote?",
    placeholders: [],
    applicability: { kind: "SPECIFIC_BODY", zips: ["85701"], subject: "Pima County Board of Supervisors" },
  };
  const instances = generateInstances([template], universes, NOW);
  const defect = checkInstanceUniverse(instances, {
    zip: "85701",
    layer: "GOVERNING_BODY",
    source: "PROJECT_BODY_ENUMERATION_EVIDENCE",
    memberIds: ["ocd/a#board", "ocd/b#council"],
  });

  /*
   * A defect is still reported — no per-body coverage question exists anywhere,
   * which is real — but it must be the RIGHT defect. The old behaviour reported
   * the two enumerated bodies as "missing", which reads as a generator that
   * dropped them and sends a reader hunting for a regression that never
   * happened.
   */
  assert.equal(defect?.kind, "NO_GENERATED_POPULATION");
  assert.deepEqual(defect?.missingSubjects, []);
  assert.match(String(defect?.detail), /NO GENERATED_FROM_REGISTRY template/);
});
