import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PublicStatementsProfileContent,
  statementsLoadFor,
  settleStatementsAnswer,
} from "../components/officials/public-statements-profile.tsx";
import { PRL_RHETORIC_ATTRIBUTION } from "../lib/sources/prl/types.ts";
import type { PrlReaderProfile } from "../lib/sources/prl/snapshot.ts";

/**
 * **PUBLIC STATEMENTS IN THE APPROVED READER DESIGN** (2026-09-28), and the
 * lead's review of `49e7b4a4`: every fetch outcome settles to one state, the
 * chart draws only the HELD numeric shares on one 0–100 scale, and the PRL
 * sentences still reach the markup (the reader proof checks them).
 *
 * FIXTURE ONLY: the profile below is a hand-made test record in the reader
 * contract's shape, not a held production profile.
 */

const SUBJECT = "congress:K000377";

function fixtureProfile(withShares: boolean): PrlReaderProfile {
  const categories = [
    { id: "policy", share: 71.2, sentence: "Fixture sentence about policy." },
    { id: "attack-policy", share: 18.4, sentence: "Fixture sentence about policy criticism." },
    { id: "attack-personal", share: 3.1, sentence: "Fixture sentence about personal attacks." },
    { id: "creditclaiming", share: 29.0, sentence: "Fixture sentence about credit claiming." },
    { id: "bipartisanship", share: 16.4, sentence: "Fixture sentence about bipartisanship." },
  ];
  return {
    subjectId: SUBJECT,
    bioguideId: "K000377",
    statementCount: 7918,
    measuredAt: "2026-09-27",
    readAt: "2026-09-28T00:00:00.000Z",
    categories: withShares
      ? categories
      : categories.map(({ id, sentence }) => ({ id, sentence })),
    attribution: PRL_RHETORIC_ATTRIBUTION,
    sourceUrl: "https://americaspoliticalpulse.com/elites/data",
  } as unknown as PrlReaderProfile;
}

test("a congressional card starts loading; any other identity has no section", () => {
  assert.deepEqual(statementsLoadFor(SUBJECT), { kind: "loading" });
  assert.deepEqual(statementsLoadFor("ocd-person/abc"), { kind: "not-applicable" });
  // The broken `d{6}` form the lead found must not come back: a real id matches.
  assert.equal(statementsLoadFor("congress:A000055").kind, "loading");
});

test("every successful answer settles — held, null and unexpected subject", () => {
  const profile = fixtureProfile(true);
  assert.equal(settleStatementsAnswer(SUBJECT, { profile }).kind, "held");
  assert.deepEqual(settleStatementsAnswer(SUBJECT, { profile: null }), { kind: "none" });
  assert.deepEqual(settleStatementsAnswer(SUBJECT, {}), { kind: "none" });
  assert.deepEqual(settleStatementsAnswer(SUBJECT, null), { kind: "none" });
  assert.deepEqual(
    settleStatementsAnswer("congress:B000001", { profile }),
    { kind: "none" },
    "a profile for a different member never renders on this card",
  );
});

test("the failed state offers a retry, and retry returns to loading", async () => {
  const src = (await import("node:fs")).readFileSync(
    "components/officials/public-statements-profile.tsx",
    "utf8",
  );
  const failed = src.slice(src.indexOf('case "failed":'), src.indexOf('case "held":'));
  assert.match(failed, /Try again/);
  assert.match(failed, /setLoad\(\{ kind: "loading" \}\)/);
  assert.match(failed, /setAttempt\(/);
});

test("held numeric shares draw five bars on one 0–100 scale, never counts", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicStatementsProfileContent, { profile: fixtureProfile(true) }),
  );
  const widths = [...markup.matchAll(/class="mw-bar-fill" style="width:([\d.]+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths, [71.2, 18.4, 3.1, 29, 16.4], "each bar is the held share itself, not normalised");
  assert.equal(widths.reduce((a, b) => a + b, 0) > 100, true, "overlapping categories are not forced to 100");
  for (const label of ["Policy discussion", "Policy criticism", "Personal attacks", "Accomplishments", "Bipartisanship"]) {
    assert.ok(markup.includes(label), `${label} is labelled`);
  }
  assert.ok(markup.includes(">71%<"), "values are printed, not colour alone");
  assert.doesNotMatch(markup, /5,6\d\d statements|× 7,918/, "no per-category count is derived from the tracked total");
  // The reader proof's contract: every held sentence reaches the markup.
  for (const sentence of fixtureProfile(true).categories.map((c) => c.sentence)) {
    assert.ok(markup.includes(sentence), `sentence in markup: ${sentence}`);
  }
  assert.ok(markup.includes(PRL_RHETORIC_ATTRIBUTION.citation.replace(/'/g, "&#x27;")), "the dataset citation is present");
  assert.ok(markup.includes(PRL_RHETORIC_ATTRIBUTION.licenceUrl));
  assert.ok(markup.includes('data-statement-feed="not-held"'), "the missing feed is stated, not faked");
});

test("FE-15: PRL's dates, citation and licence sit in Sources, never on the card face", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicStatementsProfileContent, { profile: fixtureProfile(true) }),
  );
  const at = markup.indexOf("data-card-sources");
  assert.ok(at > 0, "the PRL citation reaches a Sources section");
  const face = markup.slice(0, at);
  assert.doesNotMatch(face, /Measured|\bRead\b/, "no measured or read date on the face");
  assert.doesNotMatch(face, /americaspoliticalpulse\.com|creativecommons\.org|CC BY/, "no citation host or licence on the face");
  assert.match(face, /statements tracked\./, "the tracked count stays with the facts");
  const sources = markup.slice(at);
  assert.match(sources, /Measured /);
  assert.match(sources, /CC BY/);
});

test("without numeric shares the section falls back to the held sentences", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicStatementsProfileContent, { profile: fixtureProfile(false) }),
  );
  assert.doesNotMatch(markup, /mw-bar-fill/, "no bar is drawn from a sentence");
  for (const sentence of fixtureProfile(false).categories.map((c) => c.sentence)) {
    assert.ok(markup.includes(sentence));
  }
});
