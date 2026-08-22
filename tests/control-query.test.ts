/**
 * RULING 68 — a control query is mandatory on any route that can echo, wall or
 * template.
 *
 * The guards here are about the three shapes that produced thirty-two
 * fabricated findings in one session, all of them HTTP 200:
 *
 *  - an SPA shell (bsky.app returned a byte-identical 5,989 for any handle),
 *  - a login wall (instagram.com returned ~615 KB for any handle),
 *  - a no-results page echoing the query into its own HTML, so a substring test
 *    for the surname passed on a page saying nothing was found.
 *
 * And about the second half of the ruling, which is the one that touches a real
 * person: where an identifier was GUESSED, the best available outcome is
 * `LEAD`. Sixteen `HIT`s on sixteen guessed handles is a measurement of the
 * instrument, and reporting it as a find puts an unverified identity beside a
 * named person.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ControlledProbe,
  beyondControl,
  isQueryEcho,
  CONTROL_IDENTIFIER,
  SHELL_TOLERANCE,
  type Fetcher,
} from "../lib/hunt/control-query.ts";

const bsky = (s: string) => `https://bsky.app/profile/${s}.bsky.social`;

/** A host that serves one byte-identical shell for every identifier. */
const shellHost: Fetcher = async () => ({ status: 200, length: 5989 });

/** A host that answers with real, varying content. */
const realHost: Fetcher = async (url) => ({
  status: 200,
  length: url.includes(CONTROL_IDENTIFIER) ? 400 : 42_000,
});

test("an SPA shell is EMPTY, however confidently it returns 200", async () => {
  const probe = new ControlledProbe(shellHost);
  const r = await probe.probe(bsky, "janebradstreet", { guessed: true });
  assert.equal(r.outcome, "EMPTY");
  assert.match(r.detail, /indistinguishable/);
});

test("a guessed identifier can never be better than LEAD", async () => {
  const probe = new ControlledProbe(realHost);
  const r = await probe.probe(bsky, "janebradstreet", { guessed: true });
  assert.equal(r.outcome, "LEAD");
  assert.match(r.detail, /has NOT been established/);
});

test("a CONFIRMED identifier may be a HIT", async () => {
  const probe = new ControlledProbe(realHost);
  const r = await probe.probe(bsky, "janebradstreet", { guessed: false });
  assert.equal(r.outcome, "HIT");
});

test("a wall is REFUSED and never an absence", async () => {
  for (const status of [0, 403, 429, 500, 503]) {
    const probe = new ControlledProbe(async () => ({ status, length: 0 }));
    const r = await probe.probe(bsky, "someone", { guessed: false });
    assert.equal(r.outcome, "REFUSED", `HTTP ${status} did not read as REFUSED`);
    assert.match(r.detail, /never an absence/);
  }
});

test("the control is fetched from the SAME url shape as the query", async () => {
  const asked: string[] = [];
  const probe = new ControlledProbe(async (url) => {
    asked.push(url);
    return { status: 200, length: url.includes(CONTROL_IDENTIFIER) ? 100 : 90_000 };
  });
  await probe.probe(bsky, "realperson", { guessed: false });
  assert.equal(asked.length, 2);
  assert.ok(asked[0]!.includes(CONTROL_IDENTIFIER), "the control was not asked first");
  assert.ok(asked[0]!.startsWith("https://bsky.app/profile/"));
  assert.ok(asked[1]!.includes("realperson"));
});

test("the control is asked once per host, not once per person", async () => {
  let controlFetches = 0;
  const probe = new ControlledProbe(async (url) => {
    if (url.includes(CONTROL_IDENTIFIER)) controlFetches++;
    return { status: 200, length: url.includes(CONTROL_IDENTIFIER) ? 100 : 90_000 };
  });
  for (const who of ["a-person", "b-person", "c-person"]) {
    await probe.probe(bsky, who, { guessed: false });
  }
  assert.equal(controlFetches, 1);
});

test("a control that itself refuses makes any 200 a real difference", () => {
  // -1 is the recorded value for a control that did not answer 200. A host that
  // answers for real names and not for invented ones is behaving exactly as a
  // control is looking for, and treating that as indistinguishable would throw
  // away the clearest possible signal.
  assert.equal(beyondControl(1234, -1), true);
});

test("the tolerance survives a shell that varies slightly between requests", () => {
  // Instagram's login wall varied by 16 bytes in 615 KB seconds apart. An exact
  // equality test would have called that a find.
  assert.equal(beyondControl(615_886, 615_870), false);
  assert.equal(SHELL_TOLERANCE, 0.02);
  // And a genuinely different page still clears it.
  assert.equal(beyondControl(719_095, 615_950), true);
});

test("a no-results page that echoes the query is not a finding", () => {
  const body =
    "<html><body><h1>Search results for Bradstreet</h1><p>Sorry, no results for Bradstreet.</p></body></html>";
  assert.equal(isQueryEcho(body, "Bradstreet"), true);
});

test("a real article mentioning the name is NOT an echo", () => {
  const body =
    "<html><body><h1>Search results for Bradstreet</h1>" +
    "<article><h2>Bradstreet wins Newbury seat</h2><p>Jane Bradstreet said on Tuesday...</p></article>" +
    "</body></html>";
  assert.equal(isQueryEcho(body, "Bradstreet"), false);
});

test("a body that never mentions the term is not an echo either", () => {
  assert.equal(isQueryEcho("<html>nothing here</html>", "Bradstreet"), false);
});

/* ══ RULING 68 applied to the manifest itself ═══════════════════════════════ */

/**
 * The ruling says "any route that can echo, wall, or template". That is a
 * property of a ROUTE, so it belongs on the route rather than in the memory of
 * whoever walks it — and it is asserted here so a route added later cannot
 * quietly skip the control.
 */
test("every route that guesses an identifier also requires a control query", async () => {
  const { MANIFEST_ROUTES } = await import("../lib/hunt/branch-manifest.ts");
  const guessing = MANIFEST_ROUTES.filter((r) => r.guessesIdentifier);
  assert.ok(guessing.length > 0, "no route guesses an identifier — the flag stopped being applied");
  for (const r of guessing) {
    assert.equal(
      r.controlQueryRequired,
      true,
      `${r.id} guesses an identifier and does not require a control query`,
    );
  }
});

test("the routes that produced the fabricated findings are all flagged", async () => {
  const { MANIFEST_ROUTES } = await import("../lib/hunt/branch-manifest.ts");
  const byId = new Map(MANIFEST_ROUTES.map((r) => [r.id, r]));
  // `social-mirror` and `news-embed` are the two that reported HIT on 16 of 16.
  for (const id of ["social-mirror", "news-embed", "ad-library", "social-archive", "campaign-social"]) {
    assert.equal(byId.get(id)?.controlQueryRequired, true, `${id} is not flagged`);
  }
});

test("a search route can never be walked without a control", async () => {
  const { MANIFEST_ROUTES } = await import("../lib/hunt/branch-manifest.ts");
  const byId = new Map(MANIFEST_ROUTES.map((r) => [r.id, r]));
  // Every route whose method is "search a directory or an index by name". Each
  // one can serve a no-results page that echoes the name back.
  for (const id of [
    "search-index",
    "local-newspaper",
    "business-registry",
    "nonprofit-filing",
    "licensing-board",
    "bar-directory",
    "chamber-directory",
    "professional-directory",
    "employer-listing",
  ]) {
    assert.equal(byId.get(id)?.controlQueryRequired, true, `${id} is a search and is not flagged`);
  }
});

test("the flagged count is stated, so a silent drop is visible", async () => {
  const { MANIFEST_ROUTES } = await import("../lib/hunt/branch-manifest.ts");
  const flagged = MANIFEST_ROUTES.filter((r) => r.controlQueryRequired);
  // 22 of 41 on 2026-08-22. A floor: the manifest only grows, and a route added
  // later that can echo must raise this rather than leave it alone.
  assert.ok(
    flagged.length >= 22,
    `only ${flagged.length} of ${MANIFEST_ROUTES.length} routes require a control query`,
  );
});
