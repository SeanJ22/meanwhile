import assert from "node:assert/strict";
import test from "node:test";
import { fetchEvents, fetchEventItems } from "../lib/sources/legistar/client.ts";
import { resolveNativeBody, type LegistarClient } from "../lib/sources/legistar/client-registry.ts";

const client = (): LegistarClient => ({ slug: "tenant", bodyId: "county:governing", ocdId: "ocd-division/country:us/state:az/county:pima",
  jurisdiction: "County", publishingOrg: "County Board", timeZone: "America/Phoenix", eventBodyName: "Board of Supervisors", venues: [] });
test("a known exact official body name resolves uniquely within its tenant", async () => {
  const exact = client();
  const read = (async () => new Response(JSON.stringify([{ BodyId: 2, BodyName: "Planning Commission" }, { BodyId: 4, BodyName: "Board of Supervisors" }]))) as typeof fetch;
  assert.equal(await resolveNativeBody(exact, { fetchImpl: read }), 4);
  assert.equal(exact.eventBodyId, 4);
  const ambiguous = (async () => new Response(JSON.stringify([{ BodyId: 4, BodyName: "Board of Supervisors" }, { BodyId: 9, BodyName: "Board of Supervisors" }]))) as typeof fetch;
  await assert.rejects(resolveNativeBody(client(), { fetchImpl: ambiguous }), /AMBIGUOUS/);
});
test("event requests carry the native body filter and event items follow every page", async () => {
  const requests: URL[] = [];
  const read = (async (raw: string | URL | Request) => {
    const url = new URL(String(raw)); requests.push(url);
    if (url.pathname.endsWith("/events")) return new Response("[]");
    return new Response(JSON.stringify(requests.length === 2 ? Array.from({ length: 1000 }, (_, i) => ({ EventItemId: i + 1 })) : [{ EventItemId: 1001 }]));
  }) as typeof fetch;
  await fetchEvents("tenant", { from: "2026-10-01", to: "2026-11-01", bodyId: 4 }, { fetchImpl: read });
  assert.match(requests[0].searchParams.get("$filter")!, /EventBodyId eq 4/);
  const items = await fetchEventItems("tenant", 5, { fetchImpl: read });
  assert.equal(items.length, 1001);
  assert.match(requests[2].searchParams.get("$filter")!, /EventItemId gt 1000/);
});
