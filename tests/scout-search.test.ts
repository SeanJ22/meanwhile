/**
 * The compliant search seam: pointers only, both providers, inert without a key.
 * Every request shape is asserted against a fake fetch — no live calls.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { makeScoutSearch, braveSearch, exaSearch, type FetchLike } from "../lib/control-plane/scheduler/scout-search.ts";

interface SeenCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch that returns a scripted body per URL substring and records every call. */
function fakeFetch(script: { match: string; status?: number; body: unknown }[]): { fetchImpl: FetchLike; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const hit = script.find((s) => url.includes(s.match));
    const status = hit?.status ?? (hit ? 200 : 404);
    const text = typeof hit?.body === "string" ? hit.body : JSON.stringify(hit?.body ?? {});
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetchImpl, calls };
}

const BRAVE_BODY = { web: { results: [
  { title: "Rogers for County Attorney", url: "https://rogersforcountyattorney.com/", description: "should be ignored" },
  { title: "News", url: "https://www.concordmonitor.com/x" },
] } };
const EXA_BODY = { results: [
  { title: "Rogers for County Attorney", url: "https://rogersforcountyattorney.com/" }, // dup of brave -> deduped
  { title: "Ballotpedia", url: "https://ballotpedia.org/Sarah_Rogers" },
] };

test("makeScoutSearch is null when neither key is set — the tool stays inert", () => {
  assert.equal(makeScoutSearch({}), null);
  assert.equal(makeScoutSearch({ braveKey: "  ", exaKey: "" }), null);
  assert.notEqual(makeScoutSearch({ braveKey: "k" }), null);
  assert.notEqual(makeScoutSearch({ exaKey: "k" }), null);
});

test("Brave request: correct endpoint, X-Subscription-Token header, count; returns url+title pointers", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api.search.brave.com", body: BRAVE_BODY }]);
  const out = await braveSearch("q", "brave-key", fetchImpl, 5000, 5);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://api.search.brave.com/res/v1/web/search"), "the API host, not the disallowed search.brave.com web UI");
  assert.ok(calls[0].url.includes("count=5"));
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers["X-Subscription-Token"], "brave-key");
  assert.deepEqual(out.hits.map((h) => h.url), ["https://rogersforcountyattorney.com/", "https://www.concordmonitor.com/x"]);
  assert.ok(out.hits.every((h) => h.provider === "brave"));
});

test("Exa request: POST, Bearer auth, type fast, numResults, and NO contents / outputSchema / answer", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api.exa.ai", body: EXA_BODY }]);
  const out = await exaSearch("q", "exa-key", fetchImpl, 5000, 5, ["*.gov", "*.us"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.exa.ai/search");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer exa-key");
  const body = JSON.parse(calls[0].body ?? "{}");
  assert.equal(body.type, "fast", "a URL, not reasoning");
  assert.equal(body.numResults, 5);
  assert.deepEqual(body.includeDomains, ["*.gov", "*.us"]);
  assert.ok(!("contents" in body), "NO contents object — no page excerpts bypass the robots gate");
  assert.ok(!("outputSchema" in body), "NO outputSchema — no synthesis");
  assert.ok(!calls[0].url.includes("/answer"), "not the /answer endpoint");
  assert.deepEqual(out.hits.map((h) => h.url), ["https://rogersforcountyattorney.com/", "https://ballotpedia.org/Sarah_Rogers"]);
});

test("combined: both providers queried, results deduped by URL, errors named without failing the call", async () => {
  const { fetchImpl } = fakeFetch([
    { match: "api.search.brave.com", body: BRAVE_BODY },
    { match: "api.exa.ai", body: EXA_BODY },
  ]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl });
  assert.notEqual(search, null);
  const res = await search!({ query: "Sarah Rogers for Merrimack County Attorney" });
  assert.deepEqual([...res.providersUsed].sort(), ["brave", "exa"]);
  const urls = res.hits.map((h) => h.url);
  assert.equal(new Set(urls.map((u) => u.toLowerCase())).size, urls.length, "no duplicate URL across providers");
  assert.ok(urls.includes("https://rogersforcountyattorney.com/"));
  assert.ok(urls.includes("https://ballotpedia.org/Sarah_Rogers"));
  assert.equal(res.errors.length, 0);
});

test("combined: one provider erroring is named, the other's hits still return", async () => {
  const { fetchImpl } = fakeFetch([
    { match: "api.search.brave.com", status: 429, body: "rate limited" },
    { match: "api.exa.ai", body: EXA_BODY },
  ]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl });
  const res = await search!({ query: "q" });
  assert.deepEqual(res.providersUsed, ["exa"]);
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].startsWith("brave:") && res.errors[0].includes("429"));
  assert.ok(res.hits.length > 0, "exa's hits still return");
});

test("an empty query returns an empty result without calling any provider", async () => {
  const { fetchImpl, calls } = fakeFetch([{ match: "api", body: {} }]);
  const search = makeScoutSearch({ braveKey: "b", exaKey: "e", fetchImpl });
  const res = await search!({ query: "   " });
  assert.equal(res.hits.length, 0);
  assert.equal(calls.length, 0);
});
