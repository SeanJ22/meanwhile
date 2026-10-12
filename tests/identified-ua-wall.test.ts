/**
 * Every request carries the project's identified `User-Agent`. When a filter refuses Node's own client, the
 * same identity is asked once more through `curl` with purpose and contact beside it (rung 4). A refusal or a
 * challenge there is a WALL naming rung 4; no browser identity is borrowed and no challenge is answered.
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

/* Rung 4: the other client, with our own name only. */

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
