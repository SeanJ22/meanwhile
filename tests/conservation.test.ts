/**
 * **A-002 / S-001 · EXTRACTION CONSERVES, OR IT FAILS.**
 *
 * External correctness audit of `336a3eb`, remediated 2026-08-24. The auditor
 * could not run code, so the first test here is the finding turned into the
 * case that FAILED against the shipped contract and passes against this one.
 *
 * What was shipped asked a boolean — `droppedAny` — and a boolean cannot tell
 * one drop from ninety-nine. `100` logical inputs, `0` output, `{malformed: 1}`
 * was branded and returned clean, with ninety-nine records gone and every
 * instrument in the repo reporting health.
 *
 * The load-bearing pair is the LAST two tests, not the first. A contract that
 * only threw would push every adapter that cannot count into a lie or a crash;
 * `COULD_NOT_ASSERT` is the named, reported second state RULING 100 requires,
 * and the test that matters is that it is never silently equal to conserved.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ConservationError,
  ZeroRowExtractionError,
  accountedNormalize,
  conserve,
  isZeroRowExtraction,
  totalDropped,
} from "../lib/sources/normalize-account.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

test("A-002 · 100 in, 0 out, 1 recorded drop is a FAILURE, not an accounted run", () => {
  assert.throws(
    () =>
      accountedNormalize("adversarial", rows(100), {
        meetings: [],
        drops: { malformed: 1 },
        // The pass considered a hundred records. One drop is not an account of
        // the other ninety-nine.
      }, { logicalInput: 100 }),
    (error: unknown) => {
      assert.ok(error instanceof ConservationError, "the wrong error type — this must name the terms");
      assert.match(error.message, /99 logical record\(s\) have NO disposition/);
      assert.match(error.message, /produced 0/);
      assert.match(error.message, /dropped 1/);
      return true;
    },
  );
});

test("A-002 · the gap's SIGN is stated, because it says which way to look", () => {
  // Short: records vanished.
  assert.throws(
    () => conserve("s", { logicalInput: 10, produced: 3, dropped: 1, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /6 logical record\(s\) have NO disposition/,
  );
  // Over: something is counted twice, which is a different bug entirely.
  assert.throws(
    () => conserve("s", { logicalInput: 4, produced: 3, dropped: 3, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /2 more disposition\(s\) than records/,
  );
});

test("A-002 · every one of the four dispositions counts toward the sum", () => {
  const r = conserve("s", {
    logicalInput: 14,
    produced: 4,
    dropped: 3,
    outOfWindow: 5,
    duplicates: 2,
    unretrieved: 0,
  });
  assert.equal(r.outcome, "CONSERVED");
  assert.equal(r.accountedFor, 14);
});

/**
 * THE TWO LAYERS DO NOT ADD, AND THIS IS THE TEST THAT SAYS SO.
 *
 * `unretrieved` counts DOCUMENTS that never arrived. `logicalInput` counts
 * EVENTS the pass considered. A refused feed contributes zero events, so it is
 * already absent from `logicalInput` and adding it would double-count.
 *
 * This is not a hypothetical: the first version of this contract DID add them,
 * and `ical`'s two refusal fixtures failed with *1 more disposition than
 * records* and *4 more*. Both were the contract catching its own author mixing
 * the document layer with the event layer — which is the exact confusion the
 * old module doc used as its reason for not counting at all.
 */
test("A-002 · unretrieved DOCUMENTS are reported but never summed with logical records", () => {
  const r = conserve("ical", {
    logicalInput: 1357,
    produced: 26,
    dropped: 1290,
    outOfWindow: 41,
    duplicates: 0,
    unretrieved: 1,
  });
  assert.equal(r.outcome, "CONSERVED", "the refused feed must not make this fail");
  assert.equal(r.accountedFor, 1357);
  assert.equal(r.unretrieved, 1, "and it is still carried, because the report needs it");
});

test("A-002 · a fractional or negative counter is refused before the sum is trusted", () => {
  assert.throws(
    () => conserve("s", { logicalInput: 5, produced: -1, dropped: 6, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /produced is -1, which is not a count/,
  );
  assert.throws(
    () => conserve("s", { logicalInput: 5, produced: 2.5, dropped: 2.5, outOfWindow: 0, duplicates: 0, unretrieved: 0 }),
    /produced is 2.5, which is not a count/,
  );
});

/**
 * THE UNIT IS THE LOGICAL RECORD, NEVER THE DOCUMENT.
 *
 * One `.ics` document is one raw row and twenty meetings. The old module doc
 * used that fact to argue AGAINST conservation; it is in fact the reason the
 * count has to happen one layer down. This is the case that would break a naive
 * `meetings.length === input.length` check and must pass here.
 */
test("A-002 · one document expanding into twenty events conserves", () => {
  const r = accountedNormalize(
    "ical",
    rows(1), // ONE document
    { meetings: Array.from({ length: 18 }, () => ({}) as never), drops: { unknownVenue: 1 } },
    { logicalInput: 20, outOfWindow: 1 },
  );
  assert.equal(r.accounting.outcome, "CONSERVED");
  assert.equal(r.accounting.logicalInput, 20);
});

/**
 * RULING 100's SECOND HALF, which is the clause most likely to be skipped.
 *
 * "We produced four and nothing told us how many there should be" is a weaker
 * claim than "we produced four and there were four". A contract that could not
 * express the difference would report them the same way.
 */
test("A-002 · a pass that cannot count records COULD_NOT_ASSERT — never a silent pass", () => {
  const r = accountedNormalize("legacy", rows(3), {
    meetings: [{} as never],
    drops: { unknownVenue: 1 },
  });
  assert.equal(r.accounting.outcome, "COULD_NOT_ASSERT");
  assert.equal(r.accounting.logicalInput, null);
  assert.equal(r.accounting.accountedFor, 2, "the dispositions are still counted and reported");
});

test("A-002 · COULD_NOT_ASSERT is not CONSERVED, and nothing may read them alike", () => {
  const cannot = conserve("a", {
    logicalInput: null,
    produced: 1,
    dropped: 0,
    outOfWindow: 0,
    duplicates: 0,
    unretrieved: 0,
  });
  const did = conserve("b", {
    logicalInput: 1,
    produced: 1,
    dropped: 0,
    outOfWindow: 0,
    duplicates: 0,
    unretrieved: 0,
  });
  assert.notEqual(cannot.outcome, did.outcome);
  assert.equal(cannot.outcome, "COULD_NOT_ASSERT");
  assert.equal(did.outcome, "CONSERVED");
});

/* ------------------------------------------------------------ S-001 ----- */

test("S-001 · totalDropped sums the counters rather than asking whether any is set", () => {
  assert.equal(totalDropped({ a: 1, b: 2, c: 0 }), 3);
  assert.equal(totalDropped({}), 0);
  // Non-numeric members are ignored rather than coerced: `legistar` carries an
  // `agendasRead` count alongside its drops in the same result object.
  assert.equal(totalDropped({ a: 1, note: "x" as unknown as number }), 1);
});

test("S-001 · the zero-row predicate has ONE implementation and both callers use it", () => {
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 3, produced: 0, dropped: 0, outOfWindow: 0 }),
    true,
    "three documents in hand, nothing out, nothing dropped — RULING 43",
  );
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 3, produced: 0, dropped: 3, outOfWindow: 0 }),
    false,
    "a source that dropped everything already said why",
  );
  assert.equal(
    isZeroRowExtraction({ documentsInHand: 0, produced: 0, dropped: 0, outOfWindow: 0 }),
    false,
    "nothing fetched is an empty upstream, judged at the fetch layer",
  );
});

test("RULING 43 survives A-002 — documents in hand and nothing out still throws", () => {
  assert.throws(
    () => accountedNormalize("ical", rows(3), { meetings: [], drops: {} }, { logicalInput: 0 }),
    ZeroRowExtractionError,
  );
});
