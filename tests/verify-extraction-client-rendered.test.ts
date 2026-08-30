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
 * ## The fixture is recorded from the real page
 *
 * `tests/fixtures/rosters/vail-governing-board-payload.html` carries the five
 * name strings exactly as the district's own Nuxt payload ships them, in a
 * `<script>` tag, with the surrounding prose reduced to what the page shows a
 * reader. It is an EXCERPT of a real 200 response, not something written here.
 *
 * It deliberately does not live in `data/hunt/`, where the 1.4 MB original sits:
 * `.gitignore` excludes `/data/hunt/*.html`, so a test asserting against that
 * file passes on the machine that collected it and dies at module load on CI,
 * where the file does not exist. That is exactly what happened on the first
 * push of this test, and it is why recorded responses belong in
 * `tests/fixtures/` — the home CLAUDE.md already names for them.
 *
 * No network, so it cannot go green because a site changed.
 */

const VAIL_PAGE = readFileSync(
  "tests/fixtures/rosters/vail-governing-board-payload.html",
  "utf8",
);

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
   * two-argument call did, and it is why NH216 exists. Not one of the five
   * reached a verdict agreeing with the page that publishes them.
   */
  for (const name of SEATED) {
    const verdict = judgeName(name, rendered);
    assert.ok(
      verdict !== "AGREED" && verdict !== "AGREED_IN_EMBEDDED_DATA",
      `${name} already agreed pre-fix — this file's premise is stale`,
    );
  }
});

test("KNOWN WEAKNESS: a short given name can never reach DISAGREED, whatever the page says", () => {
  /*
   * **A second real defect in this instrument, pinned rather than fixed.**
   *
   * `judgeName` tests membership with `String.includes`, so the two-letter
   * given name "Ed" is found inside "published", "used", "provided", "amended"
   * — ordinary words on ordinary government pages. A short given name
   * therefore cannot produce `DISAGREED` no matter what the page says, which
   * silently inflates `PARTIAL`.
   *
   * It is observable in the real corpus run: against the full 1.4 MB Vail page,
   * whose prose contains "published", Ed Buster came back `PARTIAL` while his
   * four colleagues came back `DISAGREED` — the same false absence wearing a
   * softer label, which is why it went unnoticed.
   *
   * NOT fixed in this change. Widening the matcher to word boundaries moves
   * counts in `docs/extraction-verification.md`, a published report, and that
   * deserves its own measured change rather than a drive-by inside a different
   * repair. Pinned here so the next session finds it STATED — and this
   * assertion will start failing the moment somebody fixes it, which is the
   * signal to delete this test rather than to work around it.
   */
  const page = renderedText("<html><body><p>The agenda was published.</p></body></html>");
  assert.equal(
    judgeName("Ed Buster", page),
    "PARTIAL",
    "if this is now DISAGREED the substring weakness is fixed — delete this test and say so",
  );
  /* The control: a long given name on the same page is correctly DISAGREED. */
  assert.equal(judgeName("Bartholomew Buster", page), "DISAGREED");
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
