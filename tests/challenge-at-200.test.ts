import assert from "node:assert/strict";
import test from "node:test";

import { accessControlIn, TOKEN_REDIRECT_CHALLENGE } from "../lib/hunt/access-control.ts";
import { challengeIn, politeGetText, SourceHttpError } from "../lib/sources/http.ts";

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

// The size floor keeps a long article that quotes the phrase a page.
test("0C: a long document quoting the phrase is still a document", () => {
  const article =
    `<html><body><p>Checking your browser before accessing is a phrase used by ` +
    `bot-detection services.</p>${"y".repeat(25_000)}</body></html>`;
  assert.ok(article.length > 20_000);
  assert.equal(challengeIn(article), null);
});

test("0C: a 200 carrying a challenge is a FAILURE, not an empty page", async () => {
  const fetchImpl = (async () =>
    new Response(CLIENT_CHALLENGE, {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () => politeGetText("https://example.gov/page", { fetchImpl }),
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

  const res = await politeGetText("https://example.gov/page", { fetchImpl });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("John Carruth"));
});

test("NHHUNT: the modern managed challenge is caught at 30 KB, not missed", () => {
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

  assert.equal(
    challengeIn(`<html><body>${beacon}</body></html>`),
    "Cloudflare interstitial",
  );
});

const TOKEN_REDIRECT =
  "<html><head><title>Loading...</title></head><body><script type='text/javascript'>" +
  "window.location.replace('https://district.example/?ch=1&js=fixture-header.fixture-claims.fixture-signature&sid=fixture-session');" +
  "</script></body></html>";

test("SVUSD: a script-only page that sends the browser back with a signed token is an access control", () => {
  assert.ok(TOKEN_REDIRECT.length < 1_000);
  for (const page of [TOKEN_REDIRECT, TOKEN_REDIRECT.replace("location.replace(", "location.assign(")]) {
    const wall = accessControlIn({ status: 200, text: page });
    assert.equal(wall?.kind, "CHALLENGE");
    assert.match(wall?.detail ?? "", /a bot challenge \(JavaScript token redirect\) answered in place of the page with HTTP 200/);
  }
  assert.equal(challengeIn(TOKEN_REDIRECT), null);
});

test("SVUSD: a page that redirects without a signed token, or a real page carrying one, stays a page", () => {
  assert.equal(accessControlIn({ status: 200, text: "<html><script>window.location.replace('https://newsite.example/board');</script></html>" }), null);
  assert.equal(accessControlIn({ status: 200, text: "<html><script>window.location.replace('/calendar?js=1&view=month');</script></html>" }), null);
  /* A real page is larger than the floor: a token redirect quoted inside one is not the page being a wall. */
  const realPage = `<html><body><h1>Governing Board</h1>${"<p>agenda item</p>".repeat(400)}<script>${TOKEN_REDIRECT}</script></body></html>`;
  assert.ok(realPage.length > TOKEN_REDIRECT_CHALLENGE.maxBytes);
  assert.equal(accessControlIn({ status: 200, text: realPage }), null);
});
