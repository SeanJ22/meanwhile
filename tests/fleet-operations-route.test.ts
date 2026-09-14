import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/admin/fleet/operations/route.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_KEY_VAR, signSession } from "../lib/control-plane/admin-auth.ts";
import { CONTROL_PLANE_URL_VAR } from "../lib/control-plane/repository/pg-store.ts";
import { FLEET_OPERATIONS_VERSION } from "../lib/control-plane/fleet-operations.ts";

function request(origin: string, cookie?: string) {
  return new NextRequest(`${origin}/api/admin/fleet/operations`, {
    headers: { host: new URL(origin).host, ...(cookie ? { cookie } : {}) },
  });
}

test("fleet operations detail refuses public hosts and unauthenticated owners before any store read", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_TEST_NETWORK_REFUSED"); };
  try {
    const publicResponse = await GET(request(PUBLIC_SITE_ORIGIN));
    assert.equal(publicResponse.status, 404);
    assert.equal(await publicResponse.text(), "");
    const unauthenticated = await GET(request(ADMIN_ORIGIN));
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("cache-control")!, /no-store/);
  } finally { globalThis.fetch = originalFetch; }
});

test("authenticated missing-store response names unavailable data without an empty successful fleet", async () => {
  const savedKey = process.env[ADMIN_SESSION_KEY_VAR];
  const savedUrl = process.env[CONTROL_PLANE_URL_VAR];
  const originalFetch = globalThis.fetch;
  const fixtureKey = "offline-fleet-route-test-key-only-0123456789";
  process.env[ADMIN_SESSION_KEY_VAR] = fixtureKey;
  delete process.env[CONTROL_PLANE_URL_VAR];
  globalThis.fetch = async () => { throw new Error("OFFLINE_TEST_NETWORK_REFUSED"); };
  try {
    const now = Math.floor(Date.now() / 1000);
    const signed = await signSession({ sid: "adm_fleet_route_fixture", iat: now, exp: now + 300, via: "google" }, fixtureKey);
    const response = await GET(request(ADMIN_ORIGIN, `${ADMIN_SESSION_COOKIE}=${signed}`));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const body = await response.json();
    assert.equal(body.formatVersion, FLEET_OPERATIONS_VERSION);
    assert.equal(body.error.code, "CONTROL_PLANE_UNAVAILABLE");
    assert.equal(body.operations, undefined);
    assert.ok(!JSON.stringify(body).includes(fixtureKey));
  } finally {
    if (savedKey === undefined) delete process.env[ADMIN_SESSION_KEY_VAR]; else process.env[ADMIN_SESSION_KEY_VAR] = savedKey;
    if (savedUrl === undefined) delete process.env[CONTROL_PLANE_URL_VAR]; else process.env[CONTROL_PLANE_URL_VAR] = savedUrl;
    globalThis.fetch = originalFetch;
  }
});
