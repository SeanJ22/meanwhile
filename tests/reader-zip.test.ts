import assert from "node:assert/strict";
import test from "node:test";
import { resolveReaderZip, lookupReaderZip } from "../lib/reader/zip.ts";
import { GET } from "../app/api/location/zip/route.ts";
import { resolveZip } from "../lib/geo/zcta.ts";

test("typed ZIP lookups validate immediately and share only successful source-resolved places for thirty seconds", async (t) => {
  const requests: string[] = [];
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const request = input instanceof Request ? input : new Request(new URL(input, "http://localhost"));
    requests.push(request.url); return GET(request);
  });
  for (const input of ["0509", "123456", "abcde", "85701-1234"]) assert.deepEqual(await resolveReaderZip(input), { ok: false, reason: "malformed" });
  assert.equal(requests.length, 0);
  const expected = resolveZip("05009"); assert.ok(expected.ok);
  const values = await Promise.all([resolveReaderZip(" 05009 "), resolveReaderZip("05009"), lookupReaderZip("05009")]);
  assert.deepEqual(values, [expected, expected, expected.centroid]);
  assert.equal(requests.length, 1, "concurrent welcome, restored-location and card reads share one request");
  assert.deepEqual(await resolveReaderZip("05009"), resolveZip("05009"));
  assert.equal(requests.length, 1);
  now += 30_001;
  assert.deepEqual(await resolveReaderZip("05009"), resolveZip("05009"));
  assert.equal(requests.length, 2, "a fresh visit after thirty seconds reads the current shelf");
  for (let i = 0; i < 2; i++) assert.deepEqual(await resolveReaderZip("00000"), { ok: false, reason: "uncovered" });
  assert.equal(requests.length, 4, "an uncovered ZIP can be retried");
});

test("failed and malformed location responses never poison later ZIP retries", async (t) => {
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempt++;
    if (attempt === 1) throw new Error("offline");
    if (attempt === 2) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
    if (attempt === 3) return Response.json({ resolution: { ok: true, centroid: { zip: "85701", lat: 100, lng: -110 } } });
    return GET(new Request("http://localhost/api/location/zip?zip=85701"));
  });
  await assert.rejects(resolveReaderZip("85701"), /offline/);
  await assert.rejects(resolveReaderZip("85701"), /503/);
  await assert.rejects(resolveReaderZip("85701"), /Invalid ZIP/);
  assert.deepEqual(await resolveReaderZip("85701"), resolveZip("85701"));
  assert.equal(attempt, 4);
});

test("ZIP selection accepts the previous route shape while a deploy changes over", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const response = await GET(input instanceof Request ? input : new Request(new URL(input, "http://localhost")));
    const { location } = await response.json();
    return Response.json({ location });
  });
  assert.deepEqual(await resolveReaderZip("89109"), resolveZip("89109"));
  assert.deepEqual(await resolveReaderZip("99999"), { ok: false, reason: "uncovered" });
});
