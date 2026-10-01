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
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

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
  assert.match(gap.statement, /does not combine their filings into a total/i);
});

test("OWN-Q5 WIRING: real money answers name all regimes with and without applicable records", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  for (const control of [
    { question: "How much campaign money has Katie Hobbs raised?", hasMoney: true },
    { question: "What campaign money is recorded for the Pima County Board of Supervisors?", hasMoney: false },
  ]) {
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "owner-amendment-regimes" },
      body: JSON.stringify({ question: control.question, ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima"], today: "2026-09-04" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as AskAnswerPayload;
    assert.equal(body.records.some((record) => record.kind.startsWith("FINANCE_")), control.hasMoney);
    const regimes = body.gaps.filter((gap) => /^(County|State|Federal) filings:/.test(gap.statement));
    assert.equal(regimes.length, 3, "no regime's silence may answer for the other two");
    assert.equal(body.denominators.financeRegimesNamed, 3);
    assert.ok(regimes.every((gap) => gap.whose === "OURS"));
    const state = regimes.find((gap) => gap.statement.startsWith("State filings:"))!;
    assert.match(state.statement, control.hasMoney ? /uses the same state campaign-money records/ : /have not linked a verified state filing/);
    assert.ok(!regimes.some((gap) => /no (?:filings?|records?) exist/i.test(gap.statement)));
  }
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
