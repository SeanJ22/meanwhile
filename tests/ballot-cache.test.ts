import assert from "node:assert/strict";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import test from "node:test";
import { NextRequest } from "next/server";
import { compileNonPath, matchHas } from "next/dist/shared/lib/router/utils/prepare-destination.js";
import nextConfig from "../next.config.ts";
import { middleware } from "../middleware.ts";
import { BALLOT_CACHE_HEADER, BALLOT_CACHE_VARY, ballotCacheValue } from "../lib/reader/ballot-cache.ts";

/** The origin response headers Next's own header rules produce for /ballot, given the request headers middleware forwards. */
async function originHeaders(forwarded: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rule of (await nextConfig.headers!()).filter(rule => rule.source === "/ballot")) {
    const params = matchHas({ headers: forwarded } as never, {}, rule.has ?? [], rule.missing ?? []);
    if (!params) continue;
    for (const header of rule.headers) out[header.key] = compileNonPath(header.value, params);
  }
  return out;
}

/** What middleware forwards to the origin for one public request. */
async function forwarded(request: NextRequest): Promise<Record<string, string>> {
  const response = await middleware(request);
  const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean);
  return Object.fromEntries(names.map(name => [name, response.headers.get(`x-middleware-request-${name}`) ?? ""]));
}

test("ballot copies vary by ZIP and preserve Next's RSC discriminator", async () => {
  const rules = (await nextConfig.headers!()).filter(rule => rule.source === "/ballot");
  assert.equal(rules.length, 2);
  for (const rule of rules) assert.ok(rule.headers.some(header => header.key === "Netlify-Vary" && header.value === BALLOT_CACHE_VARY));
  assert.match(BALLOT_CACHE_VARY, /zip/);
  assert.match(BALLOT_CACHE_VARY, /_rsc/);
});

test("the origin answer for a known ZIP lives until Phoenix midnight and carries its state's purge tag, including 03301 and 07102", async context => {
  context.mock.method(Date, "now", () => Date.parse("2026-10-23T22:00:00Z"));
  for (const [zip, state] of [["03301", "NH"], ["07102", "NJ"], ["85701", "AZ"], ["90210", "CA"]]) {
    const headers = await originHeaders(await forwarded(new NextRequest(`${PUBLIC_SITE_ORIGIN}/ballot?zip=${zip}`)));
    assert.equal(headers["Netlify-CDN-Cache-Control"], "public, durable, max-age=32340, must-revalidate");
    assert.equal(headers["Netlify-Cache-Tag"], `reader-state:${state},reader-national-people,reader-settings`);
  }
});

test("Phoenix midnight ends today's copy and tomorrow's copy receives a new lifetime, through DST changes", () => {
  const request = new Request(`${PUBLIC_SITE_ORIGIN}/ballot?zip=03301`);
  for (const day of ["2026-10-24", "2026-11-01", "2027-03-14"]) {
    const midnight = Date.parse(`${day}T07:00:00.000Z`);
    assert.equal(ballotCacheValue(request, midnight - 1000), "1;NH");
    assert.equal(ballotCacheValue(request, midnight - 120_000), "60;NH");
    assert.equal(ballotCacheValue(request, midnight), "86340;NH");
  }
});

test("unknown ZIPs and map-point selections are never stored, and a reader cannot send its own verdict", async () => {
  for (const query of ["", "zip=00000", "zip=03301&zip=07102", "zip=03301&lat=32&lng=-110", "zip=03301&state=NJ"]) {
    assert.equal(ballotCacheValue(new Request(`${PUBLIC_SITE_ORIGIN}/ballot?${query}`)), null);
    const request = new NextRequest(`${PUBLIC_SITE_ORIGIN}/ballot?${query}`, { headers: { [BALLOT_CACHE_HEADER]: "86400;AZ" } });
    const sent = await forwarded(request);
    assert.equal(sent[BALLOT_CACHE_HEADER], undefined, query);
    const headers = await originHeaders(sent);
    assert.equal(headers["Netlify-CDN-Cache-Control"], "no-store", query);
    assert.equal(headers["Netlify-Cache-Tag"], undefined, query);
  }
});
