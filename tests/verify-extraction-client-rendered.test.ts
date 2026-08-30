import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  embeddedDataText,
  judgeName,
  renderedText,
} from "../scripts/verify-extraction.mts";

/**
 * **THE INSTRUMENT ASSERTED AN ABSENCE WITHOUT HAVING LOOKED.** (NH216, settled
 * 2026-08-29.)
 *
 * `pnpm verify:extraction` reported five of Vail Unified's six governing-board
 * members **absent from the district's own board page** and NH216 was opened
 * against the roster:
 *
 * > Vail Unified's board page — 5 of 6 extracted names are absent from it
 *
 * The roster was correct. The page publishes every one of those names, at HTTP
 * 200, in bytes a plain `fetch` receives. They live in the Apptegy/Thrillshare
 * hydration payload inside a `<script>` tag, and `renderedText` strips
 * `<script>` — right for CODE, wrong for the DATA that IS the page on a
 * client-rendered site.
 *
 * A detective re-fetch on 2026-08-29 settled it: five of the six names are on
 * the page, and the sixth (John Carruth) is legitimately not a board member —
 * he is the Superintendent, which the roster already recorded correctly.
 *
 * **This is the gravest failure available to a checking instrument here.** A
 * false `DISAGREED` is an accusation against a government's own publication, and
 * the constitution's rule admits no exception: *absence is never asserted*.
 * RULING 193 says an instrument may rest its verdict only on evidence it
 * actually checked, and this one had not checked where the names were.
 *
 * ## The fixture is the real page
 *
 * `data/hunt/vail-governing-board.html` is 1.4 MB of the district's own served
 * HTML, collected 2026-08-27. Asserting against the bytes that produced the
 * false absence is what makes this a regression test rather than a restatement
 * — and it needs no network, so it cannot go green because a site changed.
 */

const VAIL_PAGE = readFileSync("data/hunt/vail-governing-board.html", "utf8");

/** The five seated members, read off the district's own accordion panels. */
const SEATED = ["Allison Pratt", "Callie Tippett", "Jen Anderson", "Ed Buster", "Chris King"];

const rendered = renderedText(VAIL_PAGE);
const embedded = embeddedDataText(VAIL_PAGE);

test("the fixture still reproduces the false absence — otherwise this file proves nothing", () => {
  for (const name of SEATED) {
    assert.ok(
      !rendered.includes(name.toLowerCase()),
      `${name} is now in the STRIPPED text of the fixture, so the client-rendered case is no ` +
        "longer exercised and this whole file is a green no-op",
    );
    assert.ok(
      VAIL_PAGE.toLowerCase().includes(name.toLowerCase()),
      `${name} is not in the fixture at all — the fixture is not the page NH216 was opened about`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════
   RED — every one of these was DISAGREED before the payload was read
   ══════════════════════════════════════════════════════════════════════ */

test("a name published only in the client-render payload is never called absent", () => {
  for (const name of SEATED) {
    const verdict = judgeName(name, rendered, embedded);
    assert.notEqual(
      verdict,
      "DISAGREED",
      `${name} was called ABSENT from the page that publishes them — the false accusation NH216 was opened on`,
    );
    assert.equal(
      verdict,
      "AGREED_IN_EMBEDDED_DATA",
      `${name} should be recorded as agreeing via the page's render payload, got ${verdict}`,
    );
  }
});

test("without the payload the instrument reaches a WRONG verdict on every seated member", () => {
  /*
   * The counterfactual, stated rather than implied: this is what the old
   * two-argument call did, and it is why NH216 exists.
   *
   * **Four of the five come back `DISAGREED` and Ed Buster comes back
   * `PARTIAL`,** and the reason is worth recording because it is a second, real
   * weakness in this instrument. `judgeName` tests membership with
   * `String.includes`, so the given name "Ed" is found inside "published",
   * "used", "provided" — on any page in the corpus. A two-letter given name
   * therefore cannot produce `DISAGREED` no matter what the page says.
   *
   * That inflates `PARTIAL` for short names and it is NOT fixed here: this
   * session's change is the payload blind spot, and widening the matcher to
   * word boundaries would move counts in a report that is published, which
   * deserves its own measured change rather than a drive-by. It is named in the
   * assertion below so the next session finds it stated rather than buried.
   *
   * What the assertion actually pins is the thing that matters: pre-fix, not
   * one of these names reached a verdict that agrees with the page publishing
   * them.
   */
  const preFix = SEATED.map((name) => [name, judgeName(name, rendered)] as const);
  for (const [name, verdict] of preFix) {
    assert.ok(
      verdict !== "AGREED" && verdict !== "AGREED_IN_EMBEDDED_DATA",
      `${name} already agreed pre-fix — this file's premise is stale`,
    );
  }
  assert.deepEqual(
    preFix.filter(([, v]) => v === "DISAGREED").map(([n]) => n),
    ["Allison Pratt", "Callie Tippett", "Jen Anderson", "Chris King"],
    "the set flatly accused of being absent has changed",
  );
  assert.deepEqual(
    preFix.filter(([, v]) => v === "PARTIAL").map(([n]) => n),
    ["Ed Buster"],
    'only the two-letter given name "Ed" should escape DISAGREED, via the substring weakness',
  );
});

/* ══════════════════════════════════════════════════════════════════════
   POSITIVE CONTROLS — a reader that finds everything finds nothing
   ══════════════════════════════════════════════════════════════════════ */

test("a name on no part of the page is still DISAGREED", () => {
  /* The whole value of the instrument is that it can still say NO. */
  assert.equal(judgeName("Zebediah Quartzmantle", rendered, embedded), "DISAGREED");
});

test("the payload reader takes JSON string VALUES, not script identifiers", () => {
  /*
   * Trading a false ABSENT for a false PRESENT would be the worse bargain: a
   * minified bundle carries enough identifier fragments to "find" almost any
   * surname, and a false agreement is the defect surviving the check written to
   * catch it. Only quoted string literals are read.
   */
  const html = `<html><body><script>var applyFilter = function(){};</script></body></html>`;
  const text = embeddedDataText(html);
  assert.ok(!text.includes("applyfilter"), "a bare identifier leaked in as if it were data");

  const withData = `<html><body><script>window.__D={"name":"Rosalind Applyfilter"}</script></body></html>`;
  assert.ok(
    embeddedDataText(withData).includes("rosalind applyfilter"),
    "a real JSON string value was not read",
  );
});

test("static markup still AGREES directly, and is not downgraded to the payload state", () => {
  const html = `<html><body><h2>Allison Pratt, President</h2></body></html>`;
  assert.equal(judgeName("Allison Pratt", renderedText(html), embeddedDataText(html)), "AGREED");
});
