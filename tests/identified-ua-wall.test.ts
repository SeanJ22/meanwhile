/**
 * RUNG 3b — WHEN OUR OWN NAME IS THE WALL.
 * (2026-08-26, the descent-resume session.)
 *
 * ## The measurement
 *
 * Every rung of this project's ladder appends `we-the-people civic meeting
 * index (…)` to the `User-Agent`, on purpose, so an administrator reading a
 * log has somewhere to write. The whole `*.nh.gov` family refuses that string.
 * Isolated one variable at a time against `www.nh.gov`, `www.revenue.nh.gov`
 * and `www.sos.nh.gov` on 2026-08-26 — identical on all three:
 *
 * ```
 * no headers at all                200
 * chrome UA only                   200
 * chrome UA + project suffix       403
 * project UA alone                 403
 * chrome UA + From: header         200
 * chrome UA + From + X-Purpose     200
 * full browser header set + From   200
 * ```
 *
 * Not the TLS fingerprint — `curl` carrying the same suffix is refused too, so
 * rungs 2, 3 AND 4 all failed together while a header-less request succeeded.
 * Thirty-odd New Hampshire state hosts, `sos.nh.gov` and `revenue.nh.gov`
 * among them, were refusing this project **specifically for saying who it
 * was**.
 *
 * ## What is asserted here, and what is deliberately not
 *
 * The rung is asserted: a 403 on the identified client escalates to a request
 * that keeps the identification and moves it to `From`/`X-Purpose`, and that
 * response is accepted as the document.
 *
 * The identified `User-Agent` is asserted to SURVIVE on the earlier rungs,
 * because some hosts allowlist it — `states/nj/NOTES.md` records
 * `morriscountyclerk.org` and `states/az/NOTES.md` records `tucsonaz.gov` both
 * refusing a general-purpose fetcher and admitting this project by name.
 * Dropping the suffix globally would trade one family of hosts for another,
 * and this test is what stops a later session doing that for tidiness.
 *
 * No test here touches the network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  browserProfileHeaders,
  identificationHeaders,
  identifiedBrowserHeaders,
  politeGetText,
  sourceUserAgent,
} from "../lib/sources/http.ts";

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A fetch that refuses anything naming this project in the `User-Agent`. */
function nhStyleWall(calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const ua = headers["User-Agent"] ?? headers["user-agent"] ?? "";
    const refused = ua.includes("we-the-people");
    return {
      ok: !refused,
      status: refused ? 403 : 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
      text: async () => (refused ? "denied" : "<html><title>NH.gov</title>the document</html>"),
    };
  }) as unknown as typeof fetch;
}

test("the identification still travels in the User-Agent on the early rungs", () => {
  /* Hosts that ALLOWLIST this project by name depend on this. */
  assert.match(sourceUserAgent(), /we-the-people civic meeting index/);
  assert.match(browserProfileHeaders()["User-Agent"], /we-the-people civic meeting index/);
});

test("rung 3b keeps the identification and moves it out of the User-Agent", () => {
  const h = identifiedBrowserHeaders();
  assert.doesNotMatch(
    h["User-Agent"],
    /we-the-people/,
    "rung 3b exists because that substring is the wall",
  );
  assert.equal(h["X-Purpose"], "we-the-people civic meeting index");
  assert.ok(h["X-Contact"], "an administrator still has somewhere to write");
});

test("identificationHeaders names the project without a User-Agent at all", () => {
  const h = identificationHeaders();
  assert.equal(h["X-Purpose"], "we-the-people civic meeting index");
  assert.equal(h["User-Agent"], undefined, "this set is added TO a UA, never instead of one");
});

test("a host that refuses our name is walked at rung 3b, not recorded as a wall", async () => {
  const calls: Call[] = [];
  const impl = nhStyleWall(calls);
  const res = await politeGetText("https://www.nh.gov/", {
    fetchImpl: impl,
    ladder: {
      browserFetch: impl,
      curl: async () => {
        throw new Error("rung 4 must not be reached — rung 3b already had the document");
      },
    },
  });

  assert.equal(res.status, 200);
  assert.match(res.text, /the document/);

  const uas = calls.map((c) => c.headers["User-Agent"] ?? c.headers["user-agent"] ?? "");
  assert.ok(
    uas.some((u) => u.includes("we-the-people")),
    "the identified client is tried FIRST — a host that allowlists us must still see us",
  );
  assert.ok(
    uas.some((u) => u && !u.includes("we-the-people")),
    "and the escalation drops the substring that was the wall",
  );
  const last = calls[calls.length - 1];
  assert.equal(
    last.headers["X-Purpose"],
    "we-the-people civic meeting index",
    "the rung that succeeded still said who we are",
  );
});
