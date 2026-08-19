import assert from "node:assert/strict";
import test from "node:test";

import {
  STATE_VOCABULARIES,
  renderableTerm,
  vocabularyCensus,
  type StateVocabulary,
} from "../lib/funding/state-vocabulary.ts";
import { COVERED_SLUGS } from "../lib/coverage/states.ts";

/**
 * D52 — the state money-translation program, and the gate that is the whole
 * of it.
 *
 * A state's mapping table is author-approved per state. These guards make
 * that mechanical rather than remembered: an unapproved table cannot reach a
 * reader no matter who calls it.
 */

const APPROVED: StateVocabulary = {
  state: "ZZ",
  authority: "Test Authority",
  sourceUrl: "https://example.gov/",
  collectedAt: "2026-08-19",
  terms: [
    {
      filed: "In-Kind Contribution",
      plain: "something given instead of money — goods, printing, office space",
      definitionUrl: "https://example.gov/statute",
    },
  ],
  approval: { approvedBy: "the author", approvedAt: "2026-08-19" },
  refusal: null,
};

test("D52: an UNAPPROVED table returns the state's own word, never a translation", () => {
  const proposed: StateVocabulary = { ...APPROVED, approval: null };
  const out = renderableTerm(proposed, "In-Kind Contribution");
  assert.equal(out.text, "In-Kind Contribution");
  assert.equal(out.translated, false);
  assert.ok(out.note, "an untranslated term must carry a named gap");
  // The gap says whose it is and does not invent the meaning it is withholding.
  assert.match(out.note, /haven't translated/i);
  assert.ok(
    !out.note.includes("goods, printing"),
    "the unapproved translation leaked into the note",
  );
});

test("D52: an APPROVED table translates, and only the terms it holds", () => {
  const hit = renderableTerm(APPROVED, "In-Kind Contribution");
  assert.equal(hit.translated, true);
  assert.match(hit.text, /instead of money/);
  assert.equal(hit.note, null);

  // A term the table does not carry is a named gap, never a guess.
  const miss = renderableTerm(APPROVED, "Qualifying Contribution");
  assert.equal(miss.translated, false);
  assert.equal(miss.text, "Qualifying Contribution");
  assert.match(miss.note!, /haven't written a plain-words version/i);
});

test("D52: every covered state has a vocabulary record, walled or not", () => {
  for (const slug of COVERED_SLUGS) {
    const v = STATE_VOCABULARIES.find((x) => x.state.toLowerCase() === slug);
    assert.ok(v, `${slug} has no vocabulary record at all — indistinguishable from never walked`);
  }
});

test("D52: a state with no terms carries a refusal with its rungs", () => {
  for (const v of STATE_VOCABULARIES) {
    if (v.terms.length > 0) continue;
    assert.ok(v.refusal, `${v.state} has no terms and no refusal — absence asserted`);
    assert.ok(v.refusal.rungs.length > 0, `${v.state}'s refusal lists no rungs`);
    for (const rung of v.refusal.rungs) {
      assert.match(rung.attemptedAt, /^\d{4}-\d{2}-\d{2}$/, `${v.state} rung ${rung.rung}`);
      assert.ok(rung.result.length > 0, `${v.state} rung ${rung.rung} has no result`);
    }
  }
});

test("D52: nothing ships approved that a person did not approve", () => {
  for (const v of STATE_VOCABULARIES) {
    if (!v.approval) continue;
    assert.ok(
      v.approval.approvedBy.length > 0 &&
        !/session|agent|auto|system/i.test(v.approval.approvedBy),
      `${v.state}: approval must name a PERSON — a session approving its own translation is the failure the gate exists to stop`,
    );
    assert.match(v.approval.approvedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("D52: every proposed term cites the state's own definition", () => {
  for (const v of STATE_VOCABULARIES) {
    for (const term of v.terms) {
      assert.match(
        term.definitionUrl,
        /^https:\/\//,
        `${v.state}/${term.filed}: a translation with no definition behind it is a claim with nothing behind it`,
      );
      assert.ok(term.filed.length > 0 && term.plain.length > 0);
    }
  }
});

test("D52: the census states what it has, including the zeros", () => {
  const census = vocabularyCensus(STATE_VOCABULARIES);
  assert.equal(census.states, STATE_VOCABULARIES.length);
  assert.equal(
    census.approved + census.proposed + census.walled >= census.states,
    true,
    "a state is in no bucket",
  );
  // Today every covered state is walled and none is approved. Asserted as the
  // CURRENT state so the day one opens, this fails loudly rather than sliding.
  assert.equal(census.approved, 0, "a state vocabulary is approved — update this guard");
});
