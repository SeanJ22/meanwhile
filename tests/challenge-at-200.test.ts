import assert from "node:assert/strict";
import test from "node:test";

import { challengeIn, politeGetText, SourceHttpError } from "../lib/sources/http.ts";

/**
 * F01-continued session 2, item 0C (2026-08-19) — **the fifth sighting of the
 * shape, this time in the function every adapter fetches through.**
 *
 * Apptegy's edge does not refuse an unfamiliar HTTP client. It answers with
 * `200 OK` and a 3,036-byte page titled "Client Challenge". Every layer above
 * then behaved perfectly and produced a lie: the fetch succeeded, the parse
 * succeeded, the extraction found no content because there was none, and a
 * school district that publishes its superintendent's name six times on that
 * page was recorded as publishing nothing.
 *
 * The browser rung already escalated to a different TLS stack — but only on a
 * **403**. Nobody had asked what a **200** carrying a challenge should do,
 * and the honest answers are the two this file pins: step to the other client
 * (the host serves that one the real 1.4 MB document, unchallenged, with no
 * token and no authentication), and if that is challenged too, **fail loudly
 * naming the wall** rather than handing an empty document upward.
 *
 * Measured, not assumed: `curl` receives 259,887 bytes from
 * `vailschooldistrict.org` where the in-process client receives 3,036.
 * Nothing here solves a challenge — it declines to mistake one for an answer.
 */

/** The real interstitial's distinguishing marks, at its real size. */
const CLIENT_CHALLENGE =
  `<!DOCTYPE html><html lang="en"><head>` +
  `<title>Client Challenge</title></head><body><noscript>` +
  `Please enable JavaScript</noscript></body></html>`;

const REAL_PAGE =
  `<!DOCTYPE html><html><head><title>Governing Board | Vail School District</title>` +
  `</head><body><strong>John Carruth<br>Superintendent</strong>${"x".repeat(30_000)}` +
  `</body></html>`;

test("0C: a challenge page is detected however it is spelled", () => {
  assert.equal(challengeIn(CLIENT_CHALLENGE), "Fastly/Imperva client challenge");
  assert.equal(
    challengeIn('<html><script src="/cdn-cgi/challenge-platform/h/b/x"></script></html>'),
    "Cloudflare interstitial",
  );
  assert.equal(
    challengeIn("<html><title>Just a moment...</title></html>"),
    "Cloudflare 'just a moment'",
  );
  assert.equal(
    challengeIn("<p>Checking your browser before accessing example.gov</p>"),
    "browser check",
  );
});

test("0C: a real page is never called a challenge", () => {
  assert.equal(challengeIn(REAL_PAGE), null);
  assert.equal(challengeIn("<html><body><h1>Board of Selectmen</h1></body></html>"), null);
});

/**
 * The size floor is load-bearing and this is why: a long article that quotes
 * the phrase is a page. Without the floor, the guard would refuse real
 * documents — which would be the same defect wearing the other face, exactly
 * like the marker list that took a page from 7,652 characters to 25.
 */
test("0C: a long document quoting the phrase is still a document", () => {
  const article =
    `<html><body><p>Checking your browser before accessing is a phrase used by ` +
    `bot-detection services.</p>${"y".repeat(25_000)}</body></html>`;
  assert.ok(article.length > 20_000);
  assert.equal(challengeIn(article), null);
});

test("0C: a 200 carrying a challenge is a FAILURE, not an empty page", async () => {
  // `fetchImpl` is supplied, which keeps the curl escalation out of a test —
  // the suite never touches the network.
  const fetchImpl = (async () =>
    new Response(CLIENT_CHALLENGE, {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () => politeGetText("https://example.gov/page", { profile: "browser", fetchImpl }),
    (err: unknown) => {
      assert.ok(err instanceof SourceHttpError, "must be a SourceHttpError");
      assert.match(err.message, /Client Challenge|client challenge/i);
      assert.match(err.message, /WALL, not an empty page/);
      return true;
    },
    "a challenge page served at 200 must not be returned as a successful read",
  );
});

test("0C: an ordinary 200 still comes back exactly as before", async () => {
  const fetchImpl = (async () =>
    new Response(REAL_PAGE, {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

  const res = await politeGetText("https://example.gov/page", {
    profile: "browser",
    fetchImpl,
  });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("John Carruth"));
});

/**
 * **THE SIZE FLOOR IS PER-SIGNATURE** (NH Hunt, 2026-08-20).
 *
 * The floor was global at 20 KB and Cloudflare's current managed challenge is
 * 29,809 bytes, so it sailed through. Kearsarge Regional School District's
 * board-roster page was served as one, handed to the extractor as a document,
 * and reported as `ZERO_ROWS` — a finding about the district's page when the
 * truth was that we never saw the district's page. A wall rendered as an
 * emptiness, which the transparency mandate forbids by name.
 *
 * Both halves are asserted, because fixing one broke the other on the first
 * attempt: the precise marks must fire at ANY size, and the ambiguous ones must
 * keep their floor. `cdn-cgi/challenge-platform` is ambiguous — Cloudflare
 * injects that script into ordinary pages — and removing its floor marked two
 * real, parseable Morris Hills agenda pages as refused.
 */
test("NHHUNT: the modern managed challenge is caught at 30 KB, not missed", () => {
  // The shape Kearsarge served, at the size it served it.
  const filler = "<p>lorem ipsum dolor sit amet consectetur</p>\n".repeat(700);
  const challenge =
    "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>" +
    "<div>Performing security verification</div>" +
    "<script>window._cf_chl_opt={cvId:'3'};</script>" +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' +
    filler +
    "</body></html>";
  assert.ok(challenge.length > 20_000, `the sample is ${challenge.length} bytes`);
  assert.equal(challengeIn(challenge), "Cloudflare 'just a moment'");

  // Each precise mark alone, above the old floor, with no title to help.
  for (const mark of [
    "window._cf_chl_opt = {}",
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    "<h2>Performing security verification</h2>",
  ]) {
    const page = `<html><body>${mark}${filler}</body></html>`;
    assert.ok(page.length > 20_000);
    assert.equal(
      challengeIn(page),
      "Cloudflare managed challenge",
      `a 30 KB page carrying ${mark.slice(0, 40)} read as a document`,
    );
  }
});

test("A PRECONNECT HINT IS NOT A CHALLENGE: a real page that only warms the Turnstile host stays a page", () => {
  // Chandler, AZ's City Clerk page (2026-09-24) carries this hint for its forms and 33 real sittings.
  const filler = "<p>2026 City Council Meeting Dates</p>".repeat(900);
  const page = `<html><head><link rel="preconnect" href="https://challenges.cloudflare.com" /></head><body>${filler}</body></html>`;
  assert.equal(challengeIn(page), null);
  assert.equal(challengeIn(`<html><head><link rel="dns-prefetch" href="//challenges.cloudflare.com"></head><body>${filler}</body></html>`), null);
  assert.equal(
    challengeIn(`<html><body><script async src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>${filler}</body></html>`),
    "Cloudflare managed challenge",
    "the host loaded as a script is still the mark",
  );
});

test("NHHUNT: the ambiguous marks keep their floor, so a real page stays a page", () => {
  /*
   * Cloudflare's JS-detections beacon, which it injects into ORDINARY pages.
   * Both recorded `schedulepage` fixtures carry it and both parse into real
   * meetings; reading it as a wall at any size would mark a working source
   * refused. This is the assertion that failed when the floor was first
   * removed from every signature at once.
   */
  const beacon =
    "<script>var a=document.createElement('script');" +
    "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>";
  const realPage =
    "<html><head><title>BOE Meetings</title></head><body>" +
    "<table><tr><td>September 8, 2026</td></tr></table>" +
    "<p>agenda text</p>\n".repeat(1200) +
    beacon +
    "</body></html>";
  assert.ok(realPage.length > 20_000, `the sample is ${realPage.length} bytes`);
  assert.equal(challengeIn(realPage), null, "a real agenda page was called a wall");

  // Small, it is still the interstitial it always was.
  assert.equal(
    challengeIn(`<html><body>${beacon}</body></html>`),
    "Cloudflare interstitial",
  );
});
