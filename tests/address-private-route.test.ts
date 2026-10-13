import assert from "node:assert/strict";
import test from "node:test";
// Offline only: no reader database, Netlify store, or live source may be contacted.
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_SITE_ID", "NETLIFY_BLOBS_CONTEXT", "WTP_READER_EDGE_DIR"]) delete process.env[key];
const { resolveAddressRequest } = await import("../lib/geo/address-resolve.ts");
const POST = (request: Request) => resolveAddressRequest(request, globalThis.fetch);

test("exact and pasted house addresses return divisions without coordinates and always disable caching", async t => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).hostname, "geocoding.geo.census.gov", "no unrelated outbound requests");
    return Response.json({ result: { addressMatches: [{ coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" },
      geographies: { Counties: [{ GEOID: "39049", STATE: "39", BASENAME: "Franklin", NAME: "Franklin County" }] } }] } });
  });
  for (const input of [{ street: "Capitol Sq", houseNumber: "1" }, { street: "1 Capitol Sq" }]) {
    const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST", body: JSON.stringify({ zip: "43215", ...input }) }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.basis, "EXACT_ADDRESS");
    assert.equal(body.resolution.status, "RESOLVED");
    assert.equal(body.point, undefined);
    assert.doesNotMatch(JSON.stringify(body), /39\.961232|-83\.000739|Capitol/);
    assert.deepEqual(body.excludedContestIds, []);
  }
});

test("a street sample can orient the map but gives no confirmed divisions or excluded contests", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: { addressMatches: [{ coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" } }] } }));
  const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST", body: JSON.stringify({ zip: "43215", street: "Capitol Sq" }) }));
  const body = await response.json();
  assert.equal(body.basis, "STREET_SAMPLE");
  assert.deepEqual(body.point, { lat: 39.961, lng: -83.001 });
  assert.deepEqual(body.contestIds, []);
  assert.deepEqual(body.excludedContestIds, []);
});

test("an exact match in another ZIP is offered without a second lookup or private response fields", async t => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    seen.push(new URL(String(input)).searchParams.get("address")!);
    return Response.json({ result: { addressMatches: [{ coordinates: { x: -83.000739, y: 39.961232 },
      addressComponents: { zip: "43215" } }] } });
  });
  for (const input of [{ street: "Capitol Sq", houseNumber: "1" }, { street: "1 Capitol Sq" }]) {
    const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST", body: JSON.stringify({ zip: "43216", ...input }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
    assert.deepEqual(body, { ok: true, basis: "EXACT_ADDRESS", resolution: { status: "FAILED", reason: "NOT_FOUND", resolvesInZip: "43215" }, contestIds: [], excludedContestIds: [] });
    assert.doesNotMatch(JSON.stringify(body), /coordinates|point|Capitol|39\.961232|-83\.000739/);
  }
  assert.deepEqual(seen, ["1 Capitol Sq, 43216", "1 Capitol Sq, 43216"]);
});

test("a missing constrained address gets one unconstrained ZIP lookup", async t => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const address = new URL(String(input)).searchParams.get("address")!;
    seen.push(address);
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    return Response.json({ result: { addressMatches: address.includes(",") ? [] : [{
      coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" },
    }] } });
  });
  const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST",
    body: JSON.stringify({ zip: "43216", street: "12/1 Capitol Sq" }) }));
  assert.deepEqual((await response.json()).resolution, { status: "FAILED", reason: "NOT_FOUND", resolvesInZip: "43215" });
  assert.deepEqual(seen, ["12/1 Capitol Sq, 43216", "12/1 Capitol Sq"]);
});

test("an aborted address lookup does not start ZIP recovery", async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, options?: RequestInit) => {
    calls += 1;
    controller.abort();
    assert.equal(options?.signal?.aborted, true);
    return Response.json({ result: { addressMatches: [] } });
  });
  const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST", signal: controller.signal,
    body: JSON.stringify({ zip: "43215", street: "1 Capitol Sq" }) }));
  assert.deepEqual((await response.json()).resolution, { status: "FAILED", reason: "NOT_FOUND" });
  assert.equal(calls, 1);
});

test("missing geography, failed matches, and a fallback in the same ZIP never suggest another place", async t => {
  for (const scenario of ["no-geographies", "no-match", "same-zip"] as const) {
    const seen: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      seen.push(new URL(String(input)).searchParams.get("address")!);
      return Response.json({ result: { addressMatches: scenario === "no-geographies" || (scenario === "same-zip" && seen.length === 2)
        ? [{ coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" } }] : [] } });
    });
    const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST",
      body: JSON.stringify({ zip: "43215", street: "1 Capitol Sq" }) }));
    const body = await response.json();
    assert.deepEqual(body.resolution, { status: "FAILED", reason: "NOT_FOUND" });
    assert.deepEqual(body.excludedContestIds, []);
    assert.equal(seen.length, scenario === "no-geographies" ? 1 : 2);
    t.mock.restoreAll();
  }
});

test("postal entry for a mail-only ZIP asks the Census without that ZIP and uses the ZIP it matched", async t => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    seen.push(new URL(String(input)).searchParams.get("address")!);
    return Response.json({ result: { addressMatches: [{ coordinates: { x: -83.000739, y: 39.961232 }, addressComponents: { zip: "43215" },
      geographies: { Counties: [{ GEOID: "39049", STATE: "39", BASENAME: "Franklin", NAME: "Franklin County" }] } }] } });
  });
  const response = await POST(new Request("https://meanwhile.test/api/address/resolve", { method: "POST",
    body: JSON.stringify({ zip: "00000", postalEntry: true, street: "Capitol Sq, Columbus, OH", houseNumber: "1" }) }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.basis, "EXACT_ADDRESS");
  assert.equal(body.resolution.status, "RESOLVED", "a ZIP the reader typed that the Census does not match is not a redirect under postal entry");
  assert.deepEqual(seen, ["1 Capitol Sq, Columbus, OH"]);
});
