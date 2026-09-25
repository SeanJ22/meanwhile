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
  curlRungHeaderSets,
  identificationHeaders,
  identifiedBrowserHeaders,
  politeGetText,
  SourceHttpError,
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

/*
 * RUNG 4 — THE OTHER CLIENT, OUR OWN NAME FIRST. (2026-09-25.)
 *
 * Sutton's and Newbury's calendar feeds and Kearsarge's school-board schedule
 * sit behind a Cloudflare filter that challenges Node's client on every header
 * set. Through `curl`, the old rung-4 set (a Chrome UA carrying our name) was
 * admitted about 7 times in 10 — the runner's intermittent "HTTP 403" reads —
 * while our own UA with X-Purpose / X-Contact was admitted 30 times in 30
 * (measured 2026-09-25, 22:05-22:20Z). Rung 4 now walks header sets, that one
 * first. No test here touches the network.
 */

const FEED = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Select Board Meeting\nEND:VEVENT\nEND:VCALENDAR";
const CHALLENGE = "<html><head><title>Just a moment...</title></head><body>…</body></html>";
const challenged403 = (async () => new Response(CHALLENGE, { status: 403 })) as unknown as typeof fetch;

test("rung 4's header sets: our own name with X-Purpose first, the old set second, the clean browser set last", () => {
  const rung = browserProfileHeaders();
  const [own, old, clean] = curlRungHeaderSets(rung);
  assert.equal(own["User-Agent"], sourceUserAgent(), "the first set says who we are, in the User-Agent");
  assert.equal(own["X-Purpose"], "we-the-people civic meeting index");
  assert.ok(own["X-Contact"]);
  assert.equal(own.Accept, "*/*");
  assert.deepEqual(old, rung, "the old rung-4 set is kept, unchanged, for a host that admits only it");
  assert.doesNotMatch(clean["User-Agent"], /we-the-people/, "the last set is for the host that refuses our name");
  assert.equal(clean["X-Purpose"], "we-the-people civic meeting index");
  assert.equal(curlRungHeaderSets(rung, "text/calendar")[0].Accept, "text/calendar", "a caller's Accept travels");
});

test("a Cloudflare-style host that challenges Node and refuses the old rung-4 set is read with our own name", async () => {
  const sent: Record<string, string>[] = [];
  const res = await politeGetText("https://www.suttonnh.gov/calendar/ical/calendar.ics", {
    fetchImpl: challenged403,
    expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
    ladder: {
      browserFetch: challenged403,
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
  assert.equal(sent.length, 1, "the first set was admitted, so no other set was sent");
  assert.equal(sent[0]["User-Agent"], sourceUserAgent());
});

test("a set refused with a challenge page is set aside and the next set is asked", async () => {
  const sent: Record<string, string>[] = [];
  const res = await politeGetText("https://www.kearsarge.org/district/school-board-mbc/pages/school-board-meeting-schedule", {
    fetchImpl: challenged403,
    profile: "browser",
    ladder: {
      browserFetch: challenged403,
      curl: async (_url, headers) => {
        sent.push(headers);
        return sent.length === 1
          ? { status: 200, contentType: "text/html", text: CHALLENGE }
          : { status: 200, contentType: "text/html", text: "<html><body>2026-2027 School Board Meeting Schedule</body></html>" };
      },
    },
  });
  assert.match(res.text, /Meeting Schedule/);
  assert.equal(sent.length, 2);
  assert.match(sent[1]["User-Agent"], /Chrome\/139.*we-the-people/, "the second set is the browser profile the rung was given");
});

test("every set refused is a WALL on rung 4, and a 404 is an answer that stops the walk", async () => {
  let calls = 0;
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: challenged403,
      ladder: {
        browserFetch: challenged403,
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
      assert.match(error.message, /WALL on rung 4/);
      return true;
    },
  );
  assert.equal(calls, 3, "each of the three sets was asked once");

  let asked = 0;
  await assert.rejects(
    politeGetText("https://town.example/gone.ics", {
      fetchImpl: challenged403,
      ladder: {
        browserFetch: challenged403,
        curl: async (url) => {
          asked += 1;
          throw new SourceHttpError(`HTTP 404 for ${url}`, 404, url);
        },
      },
    }),
    /HTTP 404/,
  );
  assert.equal(asked, 1, "a 404 does not change with the headers, so no other set is sent");
});
