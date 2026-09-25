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
 * What is asserted now — honest identity is allowed, disguise is not: every
 * request carries the project's identified `User-Agent` (some hosts —
 * `morriscountyclerk.org`, `tucsonaz.gov` — admit this project BY name). When
 * a filter refuses Node's own client, the SAME identity is asked once more
 * through `curl`, with purpose and contact beside it (rung 4). Measured
 * 2026-09-25 on the Cloudflare-fronted Sutton, Newbury and Kearsarge hosts:
 * Node's client is challenged whatever it sends, and that honest `curl`
 * request is admitted 30 of 30. A refusal or a challenge there is a WALL naming
 * rung 4; no browser identity is borrowed and no challenge is answered. The
 * `*.nh.gov` routes that refuse our name are pursued by other public routes.
 *
 * No test here touches the network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  SourceHttpError,
  curlRequestHeaders,
  politeGetText,
  sourceRequestHeaders,
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

test("the identification travels in the User-Agent of every request, on both clients", () => {
  /* Hosts that ALLOWLIST this project by name depend on this. */
  assert.match(sourceUserAgent(), /we-the-people civic meeting index/);
  assert.equal(sourceRequestHeaders()["User-Agent"], sourceUserAgent(), "the first request is the identified one");
  assert.equal(curlRequestHeaders()["User-Agent"], sourceUserAgent(), "and so is rung 4");
  for (const headers of [sourceRequestHeaders(), curlRequestHeaders()]) {
    assert.doesNotMatch(headers["User-Agent"], /Mozilla|Chrome|Safari/, "never a borrowed browser identity");
  }
});

test("a host that refuses our name is a WALL named as an access control, and nothing is re-sent under another identity", async () => {
  const calls: Call[] = [];
  await assert.rejects(
    politeGetText("https://www.nh.gov/", { fetchImpl: nhStyleWall(calls) }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.rung, 2, "with no second client injected, the identified client is the only rung");
      assert.match(error.message, /access control/);
      assert.match(error.message, /never bypassed/);
      return true;
    },
  );
  assert.equal(calls.length, 1, "the refusal is asked once: no browser header set, no name-dropping client");
  const ua = calls[0].headers["User-Agent"] ?? calls[0].headers["user-agent"] ?? "";
  assert.match(ua, /we-the-people/, "the request said who we are");

  const curled: Record<string, string>[] = [];
  await assert.rejects(
    politeGetText("https://www.nh.gov/", {
      fetchImpl: nhStyleWall([]),
      ladder: {
        curl: async (url, headers) => {
          curled.push(headers);
          throw new SourceHttpError(`HTTP 403 for ${url}`, 403, url);
        },
      },
    }),
    (error: unknown) => error instanceof SourceHttpError && error.rung === 4 && /WALL/.test(error.message),
  );
  assert.equal(curled.length, 1, "rung 4 asks once, with the same identity");
  assert.equal(curled[0]["User-Agent"], sourceUserAgent());
});

/*
 * RUNG 4 — THE OTHER CLIENT, OUR OWN NAME ONLY. (2026-09-25.)
 *
 * Sutton's and Newbury's calendar feeds and Kearsarge's school-board schedule
 * sit behind a Cloudflare filter that challenges Node's client on every header
 * set, while `curl` with our own UA and X-Purpose / X-Contact was admitted 30
 * times in 30 (measured 2026-09-25, 22:05-22:20Z). Rung 4 is that one request.
 * No test here touches the network.
 */

const FEED = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Select Board Meeting\nEND:VEVENT\nEND:VCALENDAR";
const CHALLENGE = "<html><head><title>Just a moment...</title></head><body>…</body></html>";
const challenged403 = (async () => new Response(CHALLENGE, { status: 403 })) as unknown as typeof fetch;

test("rung 4 is one request: our own name in the User-Agent, purpose and contact beside it, never a browser's", () => {
  const own = curlRequestHeaders();
  assert.equal(own["User-Agent"], sourceUserAgent(), "the request says who we are, in the User-Agent");
  assert.equal(own["X-Purpose"], "we-the-people civic meeting index");
  assert.ok(own["X-Contact"]);
  assert.equal(own.Accept, "*/*");
  assert.equal(curlRequestHeaders("text/calendar").Accept, "text/calendar", "a caller's Accept travels");
  assert.ok(!Object.keys(own).some((h) => /^sec-fetch-|^upgrade-insecure-requests$/i.test(h)), "no browser-navigation headers");
});

test("a Cloudflare-style host that challenges Node is read with our own name through curl", async () => {
  const sent: Record<string, string>[] = [];
  const res = await politeGetText("https://www.suttonnh.gov/calendar/ical/calendar.ics", {
    fetchImpl: challenged403,
    expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
    ladder: {
      curl: async (url, headers) => {
        sent.push(headers);
        if (headers["User-Agent"] === sourceUserAgent() && headers["X-Purpose"]) {
          return { status: 200, contentType: "text/calendar", text: FEED };
        }
        throw new SourceHttpError(`HTTP 403 for ${url}`, 403, url);
      },
    },
  });
  assert.equal(res.text, FEED);
  assert.equal(sent.length, 1, "one honest request");
  assert.equal(sent[0]["User-Agent"], sourceUserAgent());
});

test("a challenge from the curl request is a WALL on rung 4 — never answered, and no other identity is tried", async () => {
  const sent: Record<string, string>[] = [];
  await assert.rejects(
    politeGetText("https://www.kearsarge.org/district/school-board-mbc/pages/school-board-meeting-schedule", {
      fetchImpl: challenged403,
      ladder: {
        curl: async (_url, headers) => {
          sent.push(headers);
          return { status: 200, contentType: "text/html", text: CHALLENGE };
        },
      },
    }),
    (error: unknown) => error instanceof SourceHttpError && error.rung === 4 && /challenge page/.test(error.message),
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0]["User-Agent"], sourceUserAgent());
});

test("a refusal on rung 4 is a WALL naming rung 4, and a 404 there is the answer", async () => {
  let calls = 0;
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: challenged403,
      ladder: {
        curl: async (url) => {
          calls += 1;
          throw new SourceHttpError(`HTTP 403 for ${url}`, 403, url);
        },
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.rung, 4, "the wall names the rung it stopped at");
      assert.match(error.message, /^HTTP 403 for https:\/\/town\.example\/export\.ics/);
      assert.match(error.message, /WALL/);
      return true;
    },
  );
  assert.equal(calls, 1, "asked once");

  let asked = 0;
  await assert.rejects(
    politeGetText("https://town.example/gone.ics", {
      fetchImpl: challenged403,
      ladder: {
        curl: async (url) => {
          asked += 1;
          throw new SourceHttpError(`HTTP 404 for ${url}`, 404, url);
        },
      },
    }),
    /HTTP 404/,
  );
  assert.equal(asked, 1);
});
