import assert from "node:assert/strict";
import test from "node:test";
import { routineMeasureSourceOpener } from "../lib/translate/routine-source-http.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";

test("a publisher redirect loop is held after its first repeated address", async () => {
  let requests = 0;
  const open = routineMeasureSourceOpener({ repos: createMemoryRepositories(), state: "OH", root: process.cwd(),
    now: () => "2026-10-20T20:00:00Z", fetch: async url => {
      requests++;
      return new Response("Redirect", { status: 307, headers: { location: String(url) } });
    } });
  await assert.rejects(open("https://elections.example.gov/measure"), /redirects in a loop/);
  assert.equal(requests, 1);
});

test("ordinary redirects retain their actual destination and share one retrieval deadline", async () => {
  const signals: AbortSignal[] = [];
  const open = routineMeasureSourceOpener({ repos: createMemoryRepositories(), state: "OH", root: process.cwd(),
    now: () => "2026-10-20T20:00:00Z", fetch: async (url, init) => {
      signals.push(init!.signal as AbortSignal);
      return String(url).endsWith("/start") ? new Response("", { status: 302, headers: { location: "/text" } })
        : new Response("Official text", { headers: { "content-type": "text/plain" } });
    } });
  const response = await open("https://elections.example.gov/start");
  assert.equal(response.url, "https://elections.example.gov/text");
  assert.equal(await response.text(), "Official text");
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
});
