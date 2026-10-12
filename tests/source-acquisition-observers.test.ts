import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { captureSourceAcquisitions, recordAcquiredResponse } from "../lib/sources/acquisition-trace.ts";
import { retainMeetingFetchBytes } from "../lib/civic-data/meeting-research-evidence.ts";
import { fetchEvent } from "../lib/sources/legistar/client.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";

test("Legistar reads retain exact source bytes and receipts without changing global fetch", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = new TextEncoder().encode('{"EventId":42,"EventBodyName":"Council"}');
  const finalUrl = "https://webapi.legistar.com/v1/fixture/events/42?current=1";
  const retained = await retainMeetingFetchBytes(() => captureSourceAcquisitions(run =>
    run("legistar", () => fetchEvent<{ EventId: number }>("fixture", 42, { fetchImpl: async () => {
      const response = new Response(bytes);
      Object.defineProperty(response, "url", { value: finalUrl });
      return response;
    } }))), "legistar", url => url === finalUrl);
  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(retained.value.value.EventId, 42);
  assert.equal(retained.value.evidence.length, 1);
  assert.equal(retained.responses.length, 1);
  assert.deepEqual(retained.responses[0].bytes, bytes);
  assert.equal(retained.value.evidence[0].rawHash, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(retained.value.evidence[0].finalUrl, finalUrl);
});

test("parallel and nested source scopes retain only their own completed reads", async () => {
  const originalFetch = globalThis.fetch;
  const results = await Promise.all(["alpha", "beta"].map(source =>
    retainMeetingFetchBytes(() => captureSourceAcquisitions(run => run(source, async () => {
      await Promise.resolve();
      recordAcquiredResponse({ requestedUrl: `https://${source}.gov`, finalUrl: `https://${source}.gov`, httpStatus: 200,
        bytes: new TextEncoder().encode(source) });
      const nested = await captureSourceAcquisitions(inner => inner("inner", async () => {
        recordAcquiredResponse({ requestedUrl: "https://inner.gov", finalUrl: "https://inner.gov", httpStatus: 200,
          bytes: new TextEncoder().encode("inner") });
      }));
      assert.deepEqual(nested.evidence.map(row => row.source), ["inner"]);
    })), source, url => url === `https://${source}.gov`)));
  for (const [index, source] of ["alpha", "beta"].entries()) {
    assert.deepEqual(results[index].value.evidence.map(row => row.source), [source]);
    assert.deepEqual(results[index].responses.map(row => row.source), [source]);
  }
  assert.equal(globalThis.fetch, originalFetch);
});

test("shared calendar replays retain bytes once while each child keeps its own source receipt", async () => {
  let fetched = 0;
  const read = meetingFetchPass({ fetchImpl: async () => { fetched++; return new Response("calendar"); } });
  const retained = await retainMeetingFetchBytes(() => captureSourceAcquisitions(async run => {
    for (const source of ["first", "second"]) await run(source, async () => {
      assert.equal(await (await read("https://council.gov/calendar")).text(), "calendar");
    });
  }), "legistar", () => true);
  assert.equal(fetched, 1);
  assert.equal(retained.responses.length, 1);
  assert.deepEqual(retained.value.evidence.map(row => row.source), ["first", "second"]);
});

test("incomplete source bodies produce no retained evidence and a failed scope does not leak", async () => {
  const originalFetch = globalThis.fetch;
  const result = await retainMeetingFetchBytes(async () => {
    await assert.rejects(captureSourceAcquisitions(run => run("failed", () =>
      fetchEvent("incomplete", 1, { fetchImpl: async () => new Response("{}", { headers: { "content-length": "10" } }) }))),
    /content length mismatch/);
  }, "legistar", () => true);
  assert.equal(result.responses.length, 0);
  assert.equal(globalThis.fetch, originalFetch);
});
