import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";

import {
  REQUEST_SPACING_MS,
  SourceHttpError,
  decodeEntities,
  politeGetJson,
  politeGetBytes,
  politeGetText,
  sourceRequestHeaders,
  sourceUserAgent,
} from "../lib/sources/http.ts";

/** Retrieval discipline: retries, `Retry-After`, the rung recorded on a wall, identification and the JSON path. Every test injects `fetchImpl`. */

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>,
  calls: Call[] = [],
): typeof fetch {
  let i = 0;
  return (async (url: string, init: RequestInit) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(new TextEncoder().encode(spec.body ?? ""), {
      status: spec.status,
      headers: spec.headers,
    });
  }) as unknown as typeof fetch;
}

test("http: the client identifies itself on every request, and there is no browser rung", async () => {
  const ua = sourceUserAgent();
  assert.match(ua, /we-the-people civic meeting index/);
  const calls: Call[] = [];
  await politeGetText("https://example.gov/a", { fetchImpl: fakeFetch([{ status: 200, body: "<html>ok</html>" }], calls) });
  assert.equal(calls[0].headers["User-Agent"], ua, "the request carries the identified User-Agent");
});

test("http: no request carries a borrowed browser identity or browser-only navigation headers", () => {
  const headers = sourceRequestHeaders("text/html");
  assert.doesNotMatch(headers["User-Agent"], /Mozilla|Chrome|Safari|Gecko/);
  for (const name of Object.keys(headers)) {
    assert.doesNotMatch(name, /^sec-fetch-|^upgrade-insecure-requests$/i, `${name} pretends to be a browser navigation`);
  }
});

test("http: a 429 is retried, and Retry-After is honoured rather than the default backoff", async () => {
  const calls: Call[] = [];
  const started = Date.now();
  const text = await politeGetText("https://example.gov/a", {
    fetchImpl: fakeFetch(
      [
        { status: 429, headers: { "retry-after": "1" } },
        { status: 200, body: "the document" },
      ],
      calls,
    ),
  });
  const elapsed = Date.now() - started;

  assert.equal(text.text, "the document");
  assert.equal(calls.length, 2, "the 429 was not retried");
  assert.ok(
    elapsed >= 1000,
    `Retry-After said 1 second and the client waited ${elapsed}ms — a server asking us to slow down is not advisory`,
  );
});

test("http: a 500 is retried on exponential backoff when no Retry-After is given", async () => {
  const calls: Call[] = [];
  const started = Date.now();
  const result = await politeGetText("https://example.gov/b", {
    fetchImpl: fakeFetch([{ status: 500 }, { status: 200, body: "ok" }], calls),
  });
  assert.equal(result.text, "ok");
  assert.equal(calls.length, 2);
  assert.ok(
    Date.now() - started >= REQUEST_SPACING_MS,
    "the retry did not wait at least one spacing interval",
  );
});

test("http: retries are BOUNDED — a permanently failing host is not hammered", async () => {
  const calls: Call[] = [];
  await assert.rejects(
    politeGetText("https://example.gov/c", {
      fetchImpl: fakeFetch([{ status: 503 }], calls),
    }),
    (error: unknown) => error instanceof SourceHttpError && error.status === 503,
  );
  assert.ok(
    calls.length <= 3,
    `${calls.length} requests to a failing host — never degrade a public body's service`,
  );
  assert.ok(calls.length > 1, "a 503 must be retried at least once");
});

test("http: a 404 is NOT retried — it is an answer, not a wobble", async () => {
  const calls: Call[] = [];
  await assert.rejects(
    politeGetText("https://example.gov/d", {
      fetchImpl: fakeFetch([{ status: 404 }], calls),
    }),
    (error: unknown) => error instanceof SourceHttpError && error.status === 404,
  );
  assert.equal(calls.length, 1, "a 404 was retried — that is noise against a public server");
});

test("http: every wall records the RUNG it stopped at, never a terminal blocked state", async () => {
  const plain = await politeGetText("https://example.gov/e", {
    fetchImpl: fakeFetch([{ status: 404 }]),
  }).catch((error: unknown) => error as SourceHttpError);
  assert.ok(plain instanceof SourceHttpError);
  assert.equal(plain.rung, 2, "the plain profile stops at rung 2");
  assert.equal(plain.url, "https://example.gov/e", "the wall does not name its URL");

  const refused = await politeGetText("https://example.gov/f", {
    fetchImpl: fakeFetch([{ status: 403 }]),
  }).catch((error: unknown) => error as SourceHttpError);
  assert.ok(refused instanceof SourceHttpError);
  assert.equal(refused.rung, 2, "a 403 stops at rung 2 too: there is no rung above it to climb");
});

test("http: a rung is a number from the CLAUDE.md ladder, and never a `blocked` string", () => {
  const error = new SourceHttpError("x", 403, "https://example.gov");
  assert.equal(typeof error.rung, "number");
  assert.ok(error.rung >= 1 && error.rung <= 14, "a rung outside the ladder is a parallel vocabulary");
  assert.ok(
    !("blocked" in error),
    "there is deliberately no terminal blocked state — a closed route is recorded on its rung",
  );
});

test("http: an injected fetchImpl is never routed around, even on a 403", async () => {
  /* The 403 ladder shells out to curl; with an injected fetch the escalation must not fire. */
  const calls: Call[] = [];
  await assert.rejects(
    politeGetText("https://example.gov/g", {
      fetchImpl: fakeFetch([{ status: 403 }], calls),
    }),
    (error: unknown) => error instanceof SourceHttpError && error.status === 403,
  );
  assert.equal(calls.length, 1, "the 403 escalation ran against an injected fetch");
});

test("http: the content type is carried through, never inferred from the body", async () => {
  const result = await politeGetText("https://example.gov/h", {
    fetchImpl: fakeFetch([
      { status: 200, body: "BEGIN:VCALENDAR", headers: { "content-type": "text/calendar" } },
    ]),
  });
  assert.equal(result.contentType, "text/calendar");
  assert.equal(result.status, 200);

  const none = await politeGetText("https://example.gov/i", {
    fetchImpl: fakeFetch([{ status: 200, body: "x" }]),
  });
  assert.equal(none.contentType, "", "a missing content type must be empty, never guessed");
});

test("http: politeGetJson asks for JSON and parses it", async () => {
  const calls: Call[] = [];
  const value = await politeGetJson<{ members: number }>("https://example.gov/j", {
    fetchImpl: fakeFetch([{ status: 200, body: '{"members":537}' }], calls),
  });
  assert.deepEqual(value, { members: 537 });
  assert.equal(
    (calls[0].headers as Record<string, string>).Accept,
    "application/json",
    "the JSON path did not ask for JSON",
  );
});

test("http: politeGetJson on a blank 200 is a WALL, not an empty object", async () => {
  await assert.rejects(
    politeGetJson("https://example.gov/k", { fetchImpl: fakeFetch([{ status: 200, body: "   " }]) }),
    (error: unknown) => error instanceof SourceHttpError,
    "a blank body reached JSON.parse — a status is not a document",
  );
});

test("http: entity decoding covers decimal AND hex, which is how ’ reached a reader", () => {
  assert.equal(decodeEntities("Selectmen&#x27;s Board"), "Selectmen's Board");
  assert.equal(decodeEntities("Selectmen&#39;s Board"), "Selectmen's Board");
  assert.equal(decodeEntities("Town&#8217;s Board"), "Town’s Board");
  assert.equal(decodeEntities("Town&#x2019;s Board"), "Town’s Board");
  assert.equal(decodeEntities("Parks &amp; Rec"), "Parks & Rec");
  assert.equal(decodeEntities("a&nbsp;b"), "a b");
  assert.equal(decodeEntities("&lt;tag&gt;"), "<tag>");
});

test("text and binary reads preserve exact acquired bytes and redirect evidence", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff]);
  const requestedUrl = "https://county.gov/document";
  const finalUrl = "https://county.gov/current";
  const fetchImpl: typeof fetch = async () => {
    const response = new Response(bytes);
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  };
  for (const read of [politeGetText, politeGetBytes]) {
    const captured = await captureSourceAcquisitions(run => run("county", async () => { await read(requestedUrl, { fetchImpl }); }));
    assert.deepEqual(captured.evidence, [{ source: "county", requestedUrl, finalUrl, httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.byteLength }]);
  }
});

test("http: &amp; is decoded LAST, so &amp;lt; does not become a tag", () => {
  /*
   * Decoding `&amp;` first turns `&amp;lt;` into `&lt;` and then into `<`,
   * which is an injection an ordinary-looking body name can carry.
   */
  assert.equal(decodeEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
});
