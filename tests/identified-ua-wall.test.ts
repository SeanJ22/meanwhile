/**
 * WHEN OUR OWN NAME IS THE WALL — AND WHY IT STAYS A WALL.
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
 * ## What is asserted here since 2026-09-25
 *
 * From 2026-08-26 a 403 on the identified client escalated to "rung 3b": a
 * plain Chrome `User-Agent` with the project's name taken out of it. That got
 * past the filter by not saying who we are in the one field it reads, which
 * is getting past an access control. The owner decision of 2026-09-25 rules
 * that out ("This authorization does not extend to bypassing authentication or
 * other access controls"), so rung 3b is gone.
 *
 * What is asserted now: every request carries the project's identified
 * `User-Agent` (some hosts — `morriscountyclerk.org`, `tucsonaz.gov` — admit
 * this project BY name), and a host that refuses that name is a WALL, named
 * as an access control, with nothing re-sent under another identity. The
 * `*.nh.gov` routes that depended on rung 3b are pursued by other public
 * routes, never by a disguise.
 *
 * No test here touches the network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { SourceHttpError, politeGetText, sourceRequestHeaders, sourceUserAgent } from "../lib/sources/http.ts";

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

test("the identification travels in the User-Agent of every request", () => {
  /* Hosts that ALLOWLIST this project by name depend on this. */
  assert.match(sourceUserAgent(), /we-the-people civic meeting index/);
  assert.equal(sourceRequestHeaders()["User-Agent"], sourceUserAgent(), "the one client is the identified one");
  assert.doesNotMatch(sourceRequestHeaders()["User-Agent"], /Mozilla|Chrome|Safari/, "never a borrowed browser identity");
});

test("a host that refuses our name is a WALL named as an access control, and nothing is re-sent under another identity", async () => {
  const calls: Call[] = [];
  await assert.rejects(
    politeGetText("https://www.nh.gov/", { fetchImpl: nhStyleWall(calls) }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.rung, 2, "one rung, the identified client");
      assert.match(error.message, /access control/);
      assert.match(error.message, /never bypassed/);
      return true;
    },
  );
  assert.equal(calls.length, 1, "the refusal is asked once: no browser header set, no name-dropping client, no curl");
  const ua = calls[0].headers["User-Agent"] ?? calls[0].headers["user-agent"] ?? "";
  assert.match(ua, /we-the-people/, "the request said who we are");
});
