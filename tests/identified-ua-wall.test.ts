import assert from "node:assert/strict";
import test from "node:test";
import { SourceHttpError, politeGetText, sourceRequestHeaders, sourceUserAgent } from "../lib/sources/http.ts";

test("source helpers identify the client and honor the requested representation", () => {
  const headers = sourceRequestHeaders("text/calendar");
  assert.equal(headers["User-Agent"], sourceUserAgent());
  assert.match(headers["User-Agent"], /we-the-people/);
  assert.doesNotMatch(headers["User-Agent"], /Mozilla|Chrome|Safari/);
  assert.equal(headers.Accept, "text/calendar");
});

test("an access control is reported without an alternate client or identity", async () => {
  const sent: Headers[] = [];
  await assert.rejects(politeGetText("https://town.example/calendar", {
    fetchImpl: async (_url, init) => {
      sent.push(new Headers(init?.headers));
      return new Response("Forbidden", { status: 403 });
    },
  }), (error: unknown) => error instanceof SourceHttpError && error.status === 403 && /access control/.test(error.message));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].get("user-agent"), sourceUserAgent());
});

test("a challenge served as a successful response is refused", async () => {
  await assert.rejects(politeGetText("https://town.example/calendar", {
    fetchImpl: async () => new Response("<title>Just a moment...</title>", { status: 200 }),
  }), (error: unknown) => error instanceof SourceHttpError && /challenge/.test(error.message));
});
