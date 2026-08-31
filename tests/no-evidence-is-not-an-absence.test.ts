/**
 * **A MODE THAT MEANS "NOTHING BOUND" MAY NOT BE READ AS "NOTHING HELD".**
 * (Session B closure, 2026-08-31, the author's correction.)
 *
 * `MODE_FAILURE_CLASS` mapped `NO_EVIDENCE → acquisition` unconditionally,
 * under a comment whose own first clause was the missing precondition: *"the
 * subject bound and we hold nothing that answers."*
 *
 * The engine returns `NO_EVIDENCE` in two situations that mean opposite things:
 *
 * ```
 *   a subject bound, and we hold nothing about it   -> acquisition. A real gap.
 *   nothing bound, so nothing was searched          -> identity. Says nothing
 *                                                      about what we hold.
 * ```
 *
 * The case that found it, measured rather than argued: *"How did each
 * supervisor vote at the August 25, 2026 meeting?"* returns `NO_EVIDENCE` with
 * `subject: null`, and was reported as an acquisition gap — *we hold no Pima
 * roll-call votes*. The same question with the body named returns
 * `GROUNDED_CLAUDE` carrying 60 member-vote records out of **285 person-vote
 * rows held for that exact sitting**. Nothing was missing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { modeFailureClass } from "../lib/health/ask-evaluation.ts";

test("SEEDED: NO_EVIDENCE with NO bound subject is identity, never acquisition", () => {
  assert.equal(
    modeFailureClass("NO_EVIDENCE", null),
    "identity",
    "calling this acquisition asserts 'we hold nothing that answers' about a search that never " +
      "ran — an absence claimed from our own inaction",
  );
  assert.notEqual(modeFailureClass("NO_EVIDENCE", null), "acquisition");
});

test("NO_EVIDENCE WITH a bound subject is still acquisition — a real gap, kept", () => {
  /*
   * The fix must not swallow the case the mapping was right about. A question
   * that bound a government and found nothing IS an acquisition obligation.
   */
  assert.equal(
    modeFailureClass("NO_EVIDENCE", "ocd-division/country:us/state:az/county:pima#governing"),
    "acquisition",
  );
});

test("the other modes are unchanged", () => {
  assert.equal(modeFailureClass("CLARIFY", null), "identity");
  assert.equal(modeFailureClass("UNRESOLVED", null), "identity");
  assert.equal(modeFailureClass("REJECTED_FELL_BACK", "x"), "validation");
  assert.equal(modeFailureClass("OFF", null), "retrieval");
  assert.equal(modeFailureClass("TRANSPORT_FAILED", null), "retrieval");
  assert.equal(modeFailureClass("SOMETHING_NEW", null), undefined, "an unknown mode is unknown");
});
