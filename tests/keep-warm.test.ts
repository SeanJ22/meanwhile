import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET, KEEP_WARM_MARKER, MAX_HOLD_MS, primeReaderEdge } from "../app/api/warm/route.ts";
import pinger, { HOLD_MS, WARM_INSTANCES, config, pingWarm } from "../netlify/functions/keep-warm.mts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const call = (query: string, marked: boolean) =>
  GET(new Request(`${PUBLIC_SITE_ORIGIN}/api/warm${query}`, marked ? { headers: { "x-wtp-synthetic-run": KEEP_WARM_MARKER } } : {}));

test("KEEP-WARM · an unmarked call answers at once, whatever hold it asks for, and is never cached", async () => {
  const started = Date.now();
  const response = await call("?hold=900", false);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).heldMs, 0);
  assert.ok(Date.now() - started < 200, "an unmarked call does not hold its instance");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("KEEP-WARM · a marked call holds its instance for the hold asked, so overlapping calls occupy separate instances", async () => {
  const started = Date.now();
  const response = await call("?hold=60", true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).heldMs, 60);
  assert.ok(Date.now() - started >= 55);
});

test("KEEP-WARM · a hold beyond the cap, a malformed hold and an unknown parameter are refused, never quietly held", async () => {
  for (const query of [`?hold=${MAX_HOLD_MS + 1}`, "?hold=-5", "?hold=soon", "?hold=10&instances=50"]) {
    const response = await call(query, true);
    assert.equal(response.status, 400, query);
  }
  assert.equal(MAX_HOLD_MS, 1000);
});

test("KEEP-WARM · every five minutes the pinger makes fourteen overlapping marked calls to the site's own warm route", async () => {
  assert.equal(config.schedule, "*/5 * * * *");
  assert.equal(WARM_INSTANCES, 14);
  assert.ok(HOLD_MS > 0 && HOLD_MS <= MAX_HOLD_MS);
  const seen: { url: string; marker: string | null }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), marker: new Headers(init?.headers).get("x-wtp-synthetic-run") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { answered } = await pingWarm(fakeFetch);
  assert.equal(answered, WARM_INSTANCES);
  assert.equal(seen.length, WARM_INSTANCES);
  for (const call of seen) {
    assert.equal(call.url, `${PUBLIC_SITE_ORIGIN}/api/warm?hold=${HOLD_MS}`);
    assert.equal(call.marker, KEEP_WARM_MARKER);
  }
  assert.equal(typeof pinger, "function");
});

test("KEEP-WARM · a call that fails is counted as not answered and does not stop the others", async () => {
  let n = 0;
  const flaky = (async () => {
    n += 1;
    if (n % 3 === 0) throw new Error("socket hang up");
    return new Response("{}", { status: n % 5 === 0 ? 503 : 200 });
  }) as typeof fetch;
  const { answered } = await pingWarm(flaky);
  assert.equal(n, WARM_INSTANCES);
  assert.equal(answered, 14 - 4 - 2, "calls 3, 6, 9 and 12 threw; calls 5 and 10 answered 503");
});

test("KEEP-WARM · a marked call loads the separate reader indexes without database fallback; an unmarked call loads nothing", async () => {
  const nothing = { manifest: false, authorityFamilies: 0, meetings: false, ask: null };
  const marked = await (await call("?hold=0", true)).json();
  assert.deepEqual(marked.primed, nothing, "no edge store here, so nothing is loaded and nothing falls back");
  const unmarked = await (await call("?hold=0", false)).json();
  assert.equal(unmarked.primed, null);
  assert.deepEqual(await primeReaderEdge(), nothing);
  const source = readFileSync("app/api/warm/route.ts", "utf8");
  assert.match(source, /readReaderManifest\(\)/, "meeting warming reads the calendar index");
  assert.match(source, /readReaderAuthorityManifest\(\)/, "authority warming reads its separate index");
  assert.match(source, /ensureReaderAuthorityEdge\(authorityManifest, undefined, AUTHORITY_FAMILIES\.filter\(family => family !== "registry-runtime"\)\)/);
  assert.match(source, /readReaderEdgeMeetings\(\{\s*manifest,\s*fallback: \(\) => Promise\.reject\(/, "the meetings read's database fallback is refused");
  assert.doesNotMatch(source, /getDb|readPreparedMeetingsProjection|refreshOutcomeSnapshotFromPromoted/);
});
