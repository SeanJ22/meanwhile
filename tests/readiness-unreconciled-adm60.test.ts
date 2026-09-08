/**
 * **LIVE TO READERS, AND NOBODY HAS CHECKED IT.** (ADM-60, 9.7.26. Critical.)
 *
 * The owner, reading the Congressional row:
 *
 * > *"Source known — Current; Acquired — Current; Verified — Not checked yet;
 * > Shown on the Reader — yes … I'm very, very, very concerned. It's live, it's
 * > serving readers. How can it be unverified and also pushing?"*
 *
 * Nothing in the grid was lying and nothing had broken. VERIFIED is NOT_WALKED
 * because no instrument supplies it. The delivery cell is PARTIAL_OR_STALE
 * because it rests on a standing declaration, and a declaration may never climb
 * to CURRENT. `enforceMonotonicity` only downgrades a cell whose RAW state is
 * CURRENT, so it had nothing to say — no violation, no band, no sentence.
 *
 * The contradiction was real and unnamed. These assertions pin the new finding
 * to the exact shape that produced it, and — more importantly — pin it AWAY
 * from the shapes that must not raise it, because a band that fires on
 * everything is a band nobody reads.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_EVIDENCE,
  deriveGateCell,
  unreconciledDeliveries,
  type GateCell,
} from "@/lib/control-plane/readiness/gates.ts";

const NOW = "2026-09-07T12:00:00.000Z";

function cell(gate: Parameters<typeof deriveGateCell>[0], ev: Partial<typeof NO_EVIDENCE> = {}): GateCell {
  return deriveGateCell(gate, { ...NO_EVIDENCE, ...ev }, NOW);
}

/** The 9.7.26 shape: acquired, live by declaration, never reconciled. */
function theCongressionalRow(): readonly GateCell[] {
  return [
    cell("SOURCE_KNOWN", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    cell("ACQUIRED", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    // No instrument supplies VERIFIED for a districts.* capability.
    cell("VERIFIED"),
    cell("SHOWN_TO_READER", {
      covered: 9,
      total: 9,
      asOf: "2026-08-27",
      pendingProof: {
        says: "Shown on the Reader · verification proof needs a fresh check",
        detail: "a declared, trace-checked input to the Reader route that renders it",
      },
    }),
    cell("ASK_ANSWERS"),
  ];
}

test("the row the owner photographed raises the finding", () => {
  const found = unreconciledDeliveries("districts.congressional", theCongressionalRow());
  assert.equal(found.length, 1, "exactly the one live delivery gate");
  assert.equal(found[0].gate, "SHOWN_TO_READER");
  assert.match(found[0].detail, /has not been walked at all/i);
  assert.match(found[0].detail, /nobody has looked/i);
});

test("the finding never claims the data is wrong — only that nothing checked it", () => {
  const [found] = unreconciledDeliveries("districts.congressional", theCongressionalRow());
  /*
   * Asserted as the NEGATION rather than as a banned word: the sentence has to
   * be able to say "this is not a claim that anything here is wrong", and a
   * blanket ban on the word would forbid the very disclaimer that makes the
   * band safe to read. NOT_WALKED and ARGUED_ABSENT mean opposite things, and
   * this band must land on the first without ever implying the second.
   */
  assert.match(found.detail, /not a claim that anything here is wrong/i, found.detail);
  assert.match(found.detail, /nobody has looked/i, found.detail);
});

/**
 * The distinction that keeps the band meaningful. A STALE verification means
 * somebody looked and the proof aged; that is a lesser and different problem,
 * and folding it in here would make the band routine.
 */
test("a stale verification does NOT raise it — somebody looked", () => {
  const cells = [
    cell("SOURCE_KNOWN", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    cell("ACQUIRED", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    cell("VERIFIED", { covered: 9, total: 9, asOf: "2026-06-01", staleAfterDays: 30 }),
    cell("SHOWN_TO_READER", {
      covered: 9,
      total: 9,
      asOf: "2026-08-27",
      pendingProof: { says: "Shown on the Reader", detail: "declared" },
    }),
    cell("ASK_ANSWERS"),
  ];
  assert.equal(cells[2].state, "PARTIAL_OR_STALE", "precondition: stale, not unwalked");
  assert.deepEqual(unreconciledDeliveries("x", cells), []);
});

test("nothing delivered means nothing to say, however unwalked VERIFIED is", () => {
  const cells = [
    cell("SOURCE_KNOWN", { covered: 1, total: 1, asOf: "2026-08-27", staleAfterDays: null }),
    cell("ACQUIRED"),
    cell("VERIFIED"),
    cell("SHOWN_TO_READER"),
    cell("ASK_ANSWERS"),
  ];
  assert.deepEqual(unreconciledDeliveries("x", cells), []);
});

/**
 * An ARGUED_ABSENT delivery is a finished answer — "there is nothing here to
 * serve" — not an unchecked one. It must not be swept up.
 */
test("an argued absence is a complete answer, not an unreconciled delivery", () => {
  const cells = [
    cell("SOURCE_KNOWN", { covered: 1, total: 1, asOf: "2026-08-27", staleAfterDays: null }),
    cell("ACQUIRED", { covered: 1, total: 1, asOf: "2026-08-27", staleAfterDays: null }),
    cell("VERIFIED"),
    cell("SHOWN_TO_READER", { walkClosed: true, absenceStatement: "the place is unincorporated" }),
    cell("ASK_ANSWERS"),
  ];
  assert.equal(cells[3].state, "ARGUED_ABSENT");
  assert.deepEqual(unreconciledDeliveries("x", cells), []);
});

test("both delivery gates live raises one finding each, and they name their own gate", () => {
  const live = {
    covered: 9,
    total: 9,
    asOf: "2026-08-27",
    pendingProof: { says: "Shown on the Reader", detail: "declared" },
  };
  const cells = [
    cell("SOURCE_KNOWN", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    cell("ACQUIRED", { covered: 9, total: 9, asOf: "2026-08-27", staleAfterDays: null }),
    cell("VERIFIED"),
    cell("SHOWN_TO_READER", live),
    cell("ASK_ANSWERS", live),
  ];
  const found = unreconciledDeliveries("x", cells);
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((f) => f.gate),
    ["SHOWN_TO_READER", "ASK_ANSWERS"],
  );
});

/**
 * The owner forbade the "it is official, so obviously verified" shortcut, and
 * the VERIFIED contract forbids the tempting implementation of it. This pins
 * the fix to the honest side: the cell still says nobody has looked.
 */
test("the fix does not quietly turn VERIFIED green", () => {
  const cells = theCongressionalRow();
  const verified = cells.find((c) => c.gate === "VERIFIED");
  assert.equal(verified?.state, "NOT_WALKED");
  assert.match(verified?.detail ?? "", /Nobody has looked at this yet/i);
});
