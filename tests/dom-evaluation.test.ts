/**
 * **THE SEEDED FAILURES FOR THE DOM EVALUATORS.** (Part C, 2026-08-31.)
 *
 * `visual-acceptance.ts` has named five DOM_CERTIFIABLE_PROPERTIES since
 * Session A and NOTHING EVALUATED ANY OF THEM. Every one fell through
 * `visual-suite.mts`'s switch to a default arm that reported "no image
 * evaluator is implemented" — the wrong diagnosis, because an image evaluator
 * is exactly what those five must not have. The thirteen sweep rows citing a
 * `vac:` id therefore had no instrument available to them even in principle.
 *
 * Every test here is a case the evaluator must FAIL or REFUSE, not a case it
 * must pass. Passing cases are cheap and prove almost nothing; what an
 * instrument is worth is what it catches.
 *
 * The load-bearing one is `an element that renders nothing`. That is not
 * hypothetical: measured on 2026-08-31, the ballot battlecard's *Committees*
 * and *Offices near you* sections opened to `innerHTML === ""`, zero children,
 * because the slot handed in was a truthy React element that rendered null.
 * The section was present, sized and empty — and a check that asked only "is
 * the element there" would have certified it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertionFits,
  evaluateDomAssertion,
  rowSelectorFor,
  type DomAssertion,
  type DomObservation,
} from "../lib/health/dom-evaluation.ts";

/** An observation with everything defaulted to "nothing was found". */
function observed(over: Partial<DomObservation> = {}): DomObservation {
  return {
    selector: ".subject",
    matchCount: 1,
    text: "",
    attributes: {},
    href: null,
    rowCount: null,
    detailsOpen: null,
    ...over,
  };
}

/* ─────────────────── the pairing rule, refused rather than answered ────── */

test("assertionFits refuses a DOM assertion pointed at an image-only property", () => {
  const problem = assertionFits("clipping", { kind: "PRESENT" });
  assert.ok(problem, "clipping must not be certifiable by a selector");
  assert.match(problem, /inherently visual/);
  assert.match(problem, /IMAGE_EVALUATED/);
});

test("assertionFits refuses an assertion that cannot certify its DOM property", () => {
  const problem = assertionFits("element_count", { kind: "TEXT_CONTAINS", needles: ["x"] });
  assert.ok(problem);
  assert.match(problem, /cannot certify property "element_count"/);
  assert.match(problem, /COUNT/);
});

test("assertionFits accepts each DOM-certifiable property with a fitting assertion", () => {
  const fits: [Parameters<typeof assertionFits>[0], DomAssertion][] = [
    ["text_content", { kind: "TEXT_CONTAINS", needles: ["a"] }],
    ["text_content", { kind: "TEXT_ABSENT", needles: ["a"] }],
    ["element_presence", { kind: "PRESENT" }],
    ["element_presence", { kind: "ABSENT" }],
    ["element_presence", { kind: "DETAILS_COLLAPSED" }],
    ["element_count", { kind: "COUNT", expected: 3 }],
    ["element_count", { kind: "COUNT_AT_LEAST", minimum: 1 }],
    ["link_target", { kind: "LINK_TARGET", hrefContains: "/x" }],
    [
      "stated_n_equals_rendered_rows",
      { kind: "STATED_N_EQUALS_ROWS", statedPattern: "\\((\\d+)\\)", rowSelector: ".row" },
    ],
  ];
  for (const [property, assertion] of fits) {
    assert.equal(
      assertionFits(property, assertion),
      null,
      `${property} should accept ${assertion.kind}`,
    );
  }
});

/* ─────────────────── the case that measured a real defect ──────────────── */

test("an element that is PRESENT but renders nothing fails a text check", () => {
  /*
   * The ballot battlecard's Offices near you section, as measured before the
   * fix: one match, sized, and `innerText` empty. `PRESENT` would certify it.
   */
  const verdict = evaluateDomAssertion(
    observed({ selector: ".card-section-body", text: "" }),
    { kind: "TEXT_CONTAINS", needles: ["office location"] },
  );
  assert.equal(verdict.verdict, "RED");
  assert.match(verdict.detail, /office location/);
});

test("a blank element still passes a bare presence check, which is why the pair exists", () => {
  const verdict = evaluateDomAssertion(observed({ text: "" }), { kind: "PRESENT" });
  assert.equal(verdict.verdict, "GREEN");
});

/* ─────────────────── nothing found is never a pass ─────────────────────── */

test("a selector that matched nothing is NOT_EVALUABLE, never GREEN and never RED", () => {
  const needsElement: DomAssertion[] = [
    { kind: "TEXT_CONTAINS", needles: ["x"] },
    { kind: "TEXT_ABSENT", needles: ["x"] },
    { kind: "PRESENT" },
    { kind: "DETAILS_COLLAPSED" },
    { kind: "ATTRIBUTE_EQUALS", attribute: "data-x", value: "1" },
    { kind: "LINK_TARGET", hrefContains: "/x" },
    { kind: "STATED_N_EQUALS_ROWS", statedPattern: "(\\d+)", rowSelector: ".row" },
  ];
  for (const assertion of needsElement) {
    const verdict = evaluateDomAssertion(observed({ matchCount: 0, text: null }), assertion);
    assert.equal(verdict.verdict, "NOT_EVALUABLE", `${assertion.kind} on an empty match set`);
    assert.match(verdict.detail, /matched 0 element/);
  }
});

test("TEXT_ABSENT on a missing element does NOT pass — an absence check needs its subject", () => {
  /*
   * The trap this closes: "the forbidden phrase is not in an element that is
   * not on the page" is true and worthless, and it is how an absence check
   * certifies a surface that failed to render at all.
   */
  const verdict = evaluateDomAssertion(observed({ matchCount: 0, text: null }), {
    kind: "TEXT_ABSENT",
    needles: ["none is left out"],
  });
  assert.equal(verdict.verdict, "NOT_EVALUABLE");
});

test("ABSENT and the counting assertions ARE answerable at zero matches", () => {
  assert.equal(
    evaluateDomAssertion(observed({ matchCount: 0, text: null }), { kind: "ABSENT" }).verdict,
    "GREEN",
  );
  assert.equal(
    evaluateDomAssertion(observed({ matchCount: 0, text: null }), { kind: "COUNT", expected: 0 })
      .verdict,
    "GREEN",
  );
  assert.equal(
    evaluateDomAssertion(observed({ matchCount: 0, text: null }), {
      kind: "COUNT_AT_LEAST",
      minimum: 1,
    }).verdict,
    "RED",
  );
});

/* ─────────────────── text, read the way a reader reads it ──────────────── */

test("TEXT_CONTAINS names WHICH phrases are missing, not merely that one is", () => {
  const verdict = evaluateDomAssertion(observed({ text: "Email Official page" }), {
    kind: "TEXT_CONTAINS",
    needles: ["Email", "Contact form", "Official page"],
  });
  assert.equal(verdict.verdict, "RED");
  assert.match(verdict.detail, /1 of 3/);
  assert.match(verdict.detail, /Contact form/);
});

test("matching is case-insensitive, so a CSS uppercase transform cannot decide a verdict", () => {
  const verdict = evaluateDomAssertion(
    observed({ text: "WE HAVEN'T RECORDED AN AGENDA FOR THIS MEETING YET" }),
    { kind: "TEXT_ABSENT", needles: ["no agenda posted yet"] },
  );
  assert.equal(verdict.verdict, "GREEN");
  const back = evaluateDomAssertion(
    observed({ text: "NO AGENDA POSTED YET" }),
    { kind: "TEXT_ABSENT", needles: ["no agenda posted yet"] },
  );
  assert.equal(back.verdict, "RED");
});

test("an assertion that states no expectation is NOT_EVALUABLE, never a pass", () => {
  assert.equal(
    evaluateDomAssertion(observed({ text: "anything" }), { kind: "TEXT_CONTAINS", needles: [] })
      .verdict,
    "NOT_EVALUABLE",
  );
  assert.equal(
    evaluateDomAssertion(observed({ text: "anything" }), { kind: "TEXT_ABSENT", needles: [] })
      .verdict,
    "NOT_EVALUABLE",
  );
});

/* ─────────────────── the disclosure bit ────────────────────────────────── */

test("DETAILS_COLLAPSED reads the open bit, and refuses a selector that found something else", () => {
  assert.equal(
    evaluateDomAssertion(observed({ detailsOpen: false, text: "Who this is (5)" }), {
      kind: "DETAILS_COLLAPSED",
    }).verdict,
    "GREEN",
  );
  assert.equal(
    evaluateDomAssertion(observed({ detailsOpen: true }), { kind: "DETAILS_COLLAPSED" }).verdict,
    "RED",
  );
  const wrongElement = evaluateDomAssertion(observed({ detailsOpen: null }), {
    kind: "DETAILS_COLLAPSED",
  });
  assert.equal(wrongElement.verdict, "NOT_EVALUABLE");
  assert.match(wrongElement.detail, /not a <details>/);
});

/* ─────────────────── stated N equals rendered rows ─────────────────────── */

test("STATED_N_EQUALS_ROWS compares the stated number against the counted rows", () => {
  const green = evaluateDomAssertion(
    observed({ text: "See the rest (57)", rowCount: 57 }),
    { kind: "STATED_N_EQUALS_ROWS", statedPattern: "\\((\\d+)\\)", rowSelector: ".row" },
  );
  assert.equal(green.verdict, "GREEN");
  const red = evaluateDomAssertion(
    observed({ text: "See the rest (57)", rowCount: 56 }),
    { kind: "STATED_N_EQUALS_ROWS", statedPattern: "\\((\\d+)\\)", rowSelector: ".row" },
  );
  assert.equal(red.verdict, "RED");
  assert.match(red.detail, /states 57 while/);
});

test("a stated-N check with no number to read is NOT_EVALUABLE, not a silent zero", () => {
  const verdict = evaluateDomAssertion(
    observed({ text: "See the rest", rowCount: 0 }),
    { kind: "STATED_N_EQUALS_ROWS", statedPattern: "\\((\\d+)\\)", rowSelector: ".row" },
  );
  assert.equal(verdict.verdict, "NOT_EVALUABLE");
  assert.match(verdict.detail, /captured no number/);
});

test("a stated-N check whose rows were never counted is NOT_EVALUABLE", () => {
  const verdict = evaluateDomAssertion(
    observed({ text: "See the rest (3)", rowCount: null }),
    { kind: "STATED_N_EQUALS_ROWS", statedPattern: "\\((\\d+)\\)", rowSelector: ".row" },
  );
  assert.equal(verdict.verdict, "NOT_EVALUABLE");
});

test("rowSelectorFor tells the harness which extra selector to observe", () => {
  assert.equal(
    rowSelectorFor({
      kind: "STATED_N_EQUALS_ROWS",
      statedPattern: "(\\d+)",
      rowSelector: "[data-other-body-row]",
    }),
    "[data-other-body-row]",
  );
  assert.equal(rowSelectorFor({ kind: "PRESENT" }), null);
});

/* ─────────────────── links and attributes ─────────────────────────────── */

test("LINK_TARGET is a claim about where a reader is sent, and a non-link fails it", () => {
  assert.equal(
    evaluateDomAssertion(observed({ href: "https://example.gov/agenda" }), {
      kind: "LINK_TARGET",
      hrefContains: "/agenda",
    }).verdict,
    "GREEN",
  );
  assert.equal(
    evaluateDomAssertion(observed({ href: null }), { kind: "LINK_TARGET", hrefContains: "/agenda" })
      .verdict,
    "RED",
  );
});

test("ATTRIBUTE_EQUALS distinguishes a missing attribute from a different value", () => {
  const missing = evaluateDomAssertion(observed({ attributes: {} }), {
    kind: "ATTRIBUTE_EQUALS",
    attribute: "data-open",
    value: "true",
  });
  assert.equal(missing.verdict, "RED");
  assert.match(missing.detail, /carries no/);
  const different = evaluateDomAssertion(observed({ attributes: { "data-open": "false" } }), {
    kind: "ATTRIBUTE_EQUALS",
    attribute: "data-open",
    value: "true",
  });
  assert.equal(different.verdict, "RED");
  assert.match(different.detail, /this check states/);
});

/* ─────────────────── an unknown kind names the harness, not the product ── */

test("an assertion kind with no evaluator is NOT_EVALUABLE and names the missing evaluator", () => {
  const verdict = evaluateDomAssertion(
    observed(),
    { kind: "SOMETHING_NOBODY_IMPLEMENTED" } as unknown as DomAssertion,
  );
  assert.equal(verdict.verdict, "NOT_EVALUABLE");
  assert.match(verdict.detail, /no DOM evaluator is implemented/);
  assert.match(verdict.detail, /dom-evaluation\.ts/);
});
