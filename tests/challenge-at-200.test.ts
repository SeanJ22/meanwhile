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
