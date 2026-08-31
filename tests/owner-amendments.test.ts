/**
 * **THE OWNER'S AMENDMENTS ON Q5 AND Q9.** (The 8.30.26 sweep, worked
 * 2026-08-31.)
 *
 * Two rows that were carried out of the owner's workbook as PRODUCT
 * REQUIREMENTS rather than as questions, and each one names a class:
 *
 * ```
 *   OWN-Q5  a campaign-finance answer covers the county and state regimes as
 *           well as the FEC, and an FEC absence never stands in for
 *           "no records exist"
 *   OWN-Q9  every district named in an answer opens its own card
 * ```
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  financeRegimeNotesFor,
  financeScopeGapFor,
  localFinanceEvidenceFor,
} from "../lib/ask/local-finance.ts";
import type { EvidenceSubject } from "../lib/ask/evidence.ts";

const ROUTE = readFileSync("app/api/ask/grounded/route.ts", "utf8");
const ASK_BOX = readFileSync("components/ask/ask-box.tsx", "utf8");

function subject(over: Partial<EvidenceSubject> = {}): EvidenceSubject {
  return {
    kind: "PERSON",
    id: "az-statewide:governor",
    name: "Katie Hobbs",
    ...over,
  } as EvidenceSubject;
}

/* ─────────────────────────────── OWN-Q5 ─────────────────────────────────── */

test("OWN-Q5: a money answer names all three regimes, and each is OURS", () => {
  const notes = financeRegimeNotesFor(subject());
  assert.deepEqual(
    notes.map((n) => n.regime).sort(),
    ["COUNTY", "FEDERAL", "STATE"],
    "one regime missing is the defect: its silence answers for the others",
  );
  for (const note of notes) {
    assert.equal(
      note.gap.whose,
      "OURS",
      `${note.regime} is labelled ${note.gap.whose} — a regime statement says what WE searched, ` +
        "never what a government holds. THEIRS would be an absence asserted about a filing office.",
    );
    assert.ok(note.gap.statement.length > 40, `${note.regime} says nothing substantive`);
  }
});

test("OWN-Q5: no regime statement claims a government holds nothing", () => {
  /*
   * The operative half of the owner's amendment. Each sentence must be about
   * our acquisition. A sentence asserting a filing office holds no record
   * would be exactly the absence-as-fact this product refuses.
   */
  for (const note of financeRegimeNotesFor(subject())) {
    const s = note.gap.statement;
    assert.ok(
      !/no (?:such )?(?:filings?|records?|committees?) exists?\b/i.test(s),
      `${note.regime} asserts a government's absence: ${s}`,
    );
    assert.ok(
      /we|our/i.test(s),
      `${note.regime} does not say whose gap it is: ${s}`,
    );
  }
});

test("OWN-Q5: THE SEEDED FAILURE — a subject this pipeline holds nothing for still gets a scope gap", () => {
  /*
   * `localFinanceEvidenceFor` returns null for a statewide executive, a
   * federal candidate, a contest and an office. A null used to push NOTHING,
   * so one regime's silence became a claim about all money everywhere.
   */
  const statewide = subject();
  assert.equal(
    localFinanceEvidenceFor(statewide),
    null,
    "the seeded case: this module holds nothing for a statewide executive",
  );
  const gap = financeScopeGapFor(statewide);
  assert.equal(gap.whose, "OURS");
  assert.match(gap.statement, /not a finding that no filings exist/i);
});

test("OWN-Q5: a contest is answered as a contest, not as an absence", () => {
  const gap = financeScopeGapFor(subject({ kind: "CONTEST", name: "Governor" }));
  assert.equal(gap.whose, "OURS");
  assert.match(gap.statement, /links a committee to an individual candidacy/i);
});

test("OWN-Q5 WIRING: the route pushes the regimes on EVERY money question", () => {
  /*
   * Following the call rather than a string, and specifically following the
   * ELSE branch — the null path is the one that used to say nothing at all.
   */
  const block = ROUTE.slice(
    ROUTE.indexOf("if (subject && financeQuestionAsked(question))"),
  ).slice(0, 900);
  assert.match(block, /gaps\.push\(financeScopeGapFor\(subject\)\)/, "the null path now speaks");
  assert.match(
    block,
    /for \(const note of financeRegimeNotesFor\(subject\)\) gaps\.push\(note\.gap\)/,
    "the regimes are pushed OUTSIDE the found/not-found branch, so records do not suppress them",
  );
  const found = block.indexOf("records.push(...finance.records)");
  const regimes = block.indexOf("financeRegimeNotesFor");
  assert.ok(found !== -1 && regimes > found, "the regime loop runs after both branches");
});

/* ─────────────────────────────── OWN-Q9 ─────────────────────────────────── */

test("OWN-Q9: the answer panel renders the governments it named as openers", () => {
  assert.match(ASK_BOX, /function AnswerBodies\(/, "the component exists");
  assert.match(
    ASK_BOX,
    /<AnswerBodies[\s\S]{0,200}grounded=\{grounded\}/,
    "and the grounded answer panel renders it",
  );
  assert.match(ASK_BOX, /data-ask-body-open=\{body\.bodyId\}/, "each opener names its body");
});

test("OWN-Q9: the openers are keyed on IDS, never on the prose", () => {
  /*
   * The wrong implementation is scanning the sentence for names we recognise.
   * Nine Morris County governments answer to "Township Council", so a name
   * match is a door onto the wrong government — `BodyName` in this same file
   * carries that diagnosis — and highlighting words inside generated prose
   * would let the synthesis rung decide what is clickable.
   */
  const start = ASK_BOX.indexOf("function AnswerBodies(");
  const body = ASK_BOX.slice(start, ASK_BOX.indexOf("\n}\n", start));
  assert.match(body, /record\.bodyId/, "the set comes off the records' own body ids");
  assert.ok(
    !/grounded\.answer/.test(body),
    "nothing here reads the generated prose — the set is not derived from the sentence",
  );
  assert.ok(
    !/\.includes\(body\.name\)|indexOf\(body\.name\)/.test(body),
    "no name match anywhere",
  );
});

test("OWN-Q9: an unresolvable body renders NOTHING, never an inert chip", () => {
  const start = ASK_BOX.indexOf("function AnswerBodies(");
  const body = ASK_BOX.slice(start, ASK_BOX.indexOf("\n}\n", start));
  assert.match(body, /if \(rows\.length === 0\) return null/, "no rows means no row of chips");
  assert.match(body, /if \(!onOpenBody\) return null/, "no opener means no doors");
  assert.match(body, /if \(body\) rows\.push\(body\)/, "only a resolved body becomes a door");
});
