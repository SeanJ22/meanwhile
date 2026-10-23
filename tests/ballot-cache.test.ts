import assert from "node:assert/strict";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import test from "node:test";
import { NextRequest } from "next/server";
import nextConfig from "../next.config.ts";
import { middleware } from "../middleware.ts";
import { BALLOT_CACHE_VARY, ballotCacheHeaders } from "../lib/reader/ballot-cache.ts";

test("ballot cache configuration varies by ZIP and preserves Next's RSC discriminator", async () => {
  const rule = (await nextConfig.headers!()).find(rule => rule.source === "/ballot");
  assert.ok(rule);
  assert.deepEqual(rule.headers, [
    { key: "Netlify-Vary", value: BALLOT_CACHE_VARY },
    { key: "Netlify-CDN-Cache-Control", value: "public, durable, max-age=86400, must-revalidate" },
  ]);
  assert.match(BALLOT_CACHE_VARY, /zip/);
  assert.match(BALLOT_CACHE_VARY, /_rsc/);
});

test("ballot copies have the ZIP's state tag, including 03301 and 07102", async context => {
  context.mock.method(Date, "now", () => Date.parse("2026-10-23T22:00:00Z"));
  for (const [zip, state] of [["03301", "NH"], ["07102", "NJ"], ["85701", "AZ"], ["90210", "CA"]]) {
    const request = new NextRequest(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`);
    const response = await middleware(request);
    assert.equal(response.headers.get("Netlify-CDN-Cache-Control"), "public, durable, max-age=32400, must-revalidate");
    assert.equal(response.headers.get("Netlify-Cache-Tag"), `reader-state:${state},reader-national-people,reader-settings`);
    assert.equal(response.headers.get("Expires"), "Sat, 24 Oct 2026 07:00:00 GMT");
    assert.equal(response.headers.get("Date"), "Fri, 23 Oct 2026 22:00:00 GMT");
  }
});

test("Phoenix midnight ends today's copy and tomorrow's copy receives a new lifetime, through DST changes", () => {
  const request = new Request(`${PUBLIC_SITE_ORIGIN}/ballot?zip=03301`);
  for (const day of ["2026-10-24", "2026-11-01", "2027-03-14"]) {
    const midnight = Date.parse(`${day}T07:00:00.000Z`);
    assert.match(ballotCacheHeaders(request, midnight - 1000)["Netlify-CDN-Cache-Control"], /max-age=1,/);
    assert.equal(ballotCacheHeaders(request, midnight - 1000).Expires, new Date(midnight).toUTCString());
    assert.match(ballotCacheHeaders(request, midnight)["Netlify-CDN-Cache-Control"], /max-age=86400,/);
    assert.equal(ballotCacheHeaders(request, midnight).Expires, new Date(midnight + 86_400_000).toUTCString());
  }
});

test("unknown ZIPs and map-point selections cannot share a ZIP copy", () => {
  for (const query of ["", "zip=00000", "zip=03301&zip=07102", "zip=03301&lat=32&lng=-110", "zip=03301&state=NJ"]) {
    assert.deepEqual(ballotCacheHeaders(new Request(`${PUBLIC_SITE_ORIGIN}/ballot?${query}`)), { "Netlify-CDN-Cache-Control": "no-store" });
  }
});
